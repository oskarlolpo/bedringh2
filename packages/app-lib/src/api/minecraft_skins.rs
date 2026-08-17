//! # Minecraft Skins API
//!
//! ## Data Flow
//!
//! 1. Frontend calls `get_available_skins()` and `get_available_capes()`
//! 2. Backend gets the selected Minecraft account and a recent Mojang profile.
//!    If skins and capes load at the same time, they share the recent profile
//!    instead of sending the same request twice.
//! 3. The skin list is built from three places:
//!    - saved skin rows in the local app database
//!    - bundled Minecraft default skins
//!    - the active Mojang skin, if its texture is not represented by a saved
//!      skin or matching bundled default
//! 4. While building the list, any saved skin with Mojang's active texture is
//!    updated to Mojang's current model variant and cape, then returned as the
//!    equipped skin.
//! 5. Before changing a skin, the current non-default Mojang skin is preserved
//!    locally so switching away from an external skin does not lose it.
//! 6. After a Mojang change, the returned profile is saved in memory when
//!    possible. If that response cannot be read, or a later step fails, the
//!    backend asks Mojang for the profile again.
//!
//! ## Ownership
//!
//! Mojang decides which skin and cape are currently equipped. The local database
//! stores saved skin rows. A saved skin is the same saved skin when its
//! `texture_key` matches; changing its model variant or cape updates that saved
//! skin instead of creating another row.
//! When a refreshed Mojang profile reports the same texture as a saved skin but
//! a different cape or model variant, the saved skin is updated to match Mojang
//! and returned as the equipped skin.
//! A bundled default skin with no cape is redundant, so it is removed from the
//! saved-skin database and represented by the default skin list instead. A
//! bundled default skin with a cape is stored so the cape stays associated with
//! that default card, but it is still returned as a default skin rather than a
//! saved custom skin.
//!
//! `cape_id = Some(_)` means a skin should apply that specific cape.
//! `cape_id = None` means the skin should have no cape.
//!
//! ## Consistency
//!
//! A Mojang request and a SQLite write cannot be one all-or-nothing operation.
//! The backend handles this by reconciling refreshed Mojang profile data with
//! saved rows, saving skins that might be lost before changing Mojang, saving
//! uploaded skins with the texture key Mojang returns, and asking Mojang for the
//! latest profile again whenever the result is unclear.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::Duration,
};

pub use bytes::Bytes;
use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use tokio::sync::Mutex;
use url::Url;
use uuid::Uuid;

pub use crate::state::MinecraftSkinVariant;
use crate::{
    ErrorKind, State,
    state::{
        MinecraftCharacterExpressionState, MinecraftProfile,
        minecraft_skins::{
            CustomMinecraftSkin, CustomMinecraftSkinInsertPosition, mojang_api,
        },
    },
};

use super::data::Credentials;

mod assets {
    mod default {
        mod default_skins;
        pub use default_skins::DEFAULT_SKINS;
    }
    pub use default::DEFAULT_SKINS;
}

pub mod png_util;

const SKIN_CHANGE_DEBOUNCE: Duration = Duration::from_secs(10);

static PENDING_SKIN_CHANGE: LazyLock<Mutex<PendingSkinChangeState>> =
    LazyLock::new(|| Mutex::new(PendingSkinChangeState::default()));
static SKIN_CHANGE_FLUSH_LOCK: LazyLock<Mutex<()>> =
    LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Default)]
struct PendingSkinChangeState {
    pending: HashMap<Uuid, PendingSkinChangeEntry>,
}

#[derive(Debug)]
struct PendingSkinChangeEntry {
    change: PendingSkinChange,
    generation: u64,
}

enum PendingEffectiveSkinChange {
    AddAndEquipCustom {
        texture_key: Arc<str>,
        texture_blob: Bytes,
        variant: MinecraftSkinVariant,
        cape_id: Option<Uuid>,
    },
    Equip {
        skin: Skin,
    },
    Unequip,
}

impl PendingEffectiveSkinChange {
    fn is_unequip(&self) -> bool {
        matches!(self, Self::Unequip)
    }

    fn cape_id(&self) -> Option<Uuid> {
        match self {
            Self::AddAndEquipCustom { cape_id, .. } => *cape_id,
            Self::Equip { skin } => skin.cape_id,
            Self::Unequip => None,
        }
    }

    fn skin(&self) -> Option<Skin> {
        match self {
            Self::AddAndEquipCustom {
                texture_key,
                texture_blob,
                variant,
                cape_id,
            } => Some(Skin {
                texture_key: Arc::clone(texture_key),
                name: None,
                section: None,
                variant: *variant,
                cape_id: *cape_id,
                texture: png_util::blob_to_data_url(texture_blob)
                    .or_else(|| {
                        png_util::blob_to_data_url(include_bytes!(
                            "minecraft_skins/assets/default/MissingNo.png"
                        ))
                    })
                    .unwrap(),
                source: SkinSource::Custom,
                is_equipped: true,
            }),
            Self::Equip { skin } => Some(skin.clone()),
            Self::Unequip => None,
        }
    }
}

#[derive(Debug)]
enum PendingSkinChange {
    AddAndEquipCustom {
        selected_credentials: Credentials,
        texture_blob: Bytes,
        variant: MinecraftSkinVariant,
        cape_id: Option<Uuid>,
        local_texture_key: Arc<str>,
    },
    Equip {
        selected_credentials: Credentials,
        skin: Skin,
    },
    Unequip {
        selected_credentials: Credentials,
    },
}

impl PendingSkinChange {
    fn profile_id(&self) -> Uuid {
        match self {
            Self::AddAndEquipCustom {
                selected_credentials,
                ..
            }
            | Self::Equip {
                selected_credentials,
                ..
            }
            | Self::Unequip {
                selected_credentials,
            } => selected_credentials.offline_profile.id,
        }
    }

    fn matches_skin(&self, skin: &Skin) -> bool {
        match self {
            Self::AddAndEquipCustom {
                local_texture_key, ..
            } => local_texture_key.as_ref() == skin.texture_key.as_ref(),
            Self::Equip {
                skin: pending_skin, ..
            } => pending_skin.texture_key == skin.texture_key,
            Self::Unequip { .. } => false,
        }
    }
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Cape {
    /// An identifier for this cape, potentially unique to the owning player.
    pub id: Uuid,
    /// The name of the cape.
    pub name: Arc<str>,
    /// The URL of the cape PNG texture.
    pub texture: Arc<Url>,
    /// The URL of the animated cape texture (GIF/APNG), if the cape has one.
    /// Only KLauncher capes provide this.
    #[serde(default)]
    pub animated_url: Option<Arc<Url>>,
    /// Delay between animated cape positions in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<u32>,
    /// KLauncher-compatible alternate spelling for frame delay in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animation_delay: Option<u32>,
    /// Whether the cape is currently equipped in the Minecraft profile of its corresponding
    /// player.
    pub is_equipped: bool,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Skin {
    /// A key used to recognize this skin texture.
    pub texture_key: Arc<str>,
    /// The name of the skin, if available.
    pub name: Option<Arc<str>>,
    /// The section this skin should be grouped under, if available.
    #[serde(default)]
    pub section: Option<Arc<str>>,
    /// The variant of the skin model.
    pub variant: MinecraftSkinVariant,
    /// The UUID of the cape that this skin uses, if any.
    ///
    /// If `None`, this skin uses no cape.
    pub cape_id: Option<Uuid>,
    /// The URL of the skin PNG texture. Can also be a data URL.
    pub texture: Arc<Url>,
    /// The source of the skin, which represents how the app knows about it.
    pub source: SkinSource,
    /// Whether the skin is currently equipped in the Minecraft profile of its corresponding
    /// player.
    pub is_equipped: bool,
}

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SkinSource {
    /// A default Minecraft skin, which may be assigned to players at random by default.
    Default,
    /// A skin that is not the default, but is not a custom skin managed by our app either.
    CustomExternal,
    /// A custom skin we have set up in our app.
    Custom,
}

/// Represents either a URL or a blob for a Minecraft skin PNG texture.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub enum UrlOrBlob {
    Url(Url),
    Blob(Bytes),
}

/// Gets the capes for the selected Minecraft profile.
/// Only one cape can be equipped.
#[tracing::instrument]
pub async fn get_available_capes() -> crate::Result<Vec<Cape>> {
    let state = State::get().await?;

    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    // KLauncher accounts cannot query the Mojang profile endpoint; their
    // capes live on the KLauncher server instead.
    if let Some(kl_token) = klauncher_token(&selected_credentials) {
        return get_klauncher_capes(&selected_credentials, kl_token).await;
    }

    let Some(profile) = selected_credentials.online_profile_fresh().await
    else {
        return Ok(Vec::new());
    };

    let pending_skin_change = pending_effective_skin_change(profile.id).await;
    let pending_cape_id = pending_skin_change
        .as_ref()
        .map(PendingEffectiveSkinChange::cape_id);

    Ok(profile
        .capes
        .iter()
        .map(|cape| Cape {
            id: cape.id,
            name: Arc::clone(&cape.name),
            texture: Arc::clone(&cape.url),
            animated_url: None,
            delay: None,
            animation_delay: None,
            is_equipped: pending_cape_id.map_or_else(
                || cape.state == MinecraftCharacterExpressionState::Active,
                |cape_id| cape_id == Some(cape.id),
            ),
        })
        .collect())
}

/// Gets the skins for the selected Minecraft profile.
/// Returns saved custom skins, bundled default skins, and the active Mojang skin if its texture
/// is not represented by a saved skin or matching bundled default.
///
/// Saved skins are identified by texture key. If Mojang reports that a saved skin is active with
/// a different model variant or cape, the saved row is updated and returned as equipped.
/// Exactly one returned skin is marked as equipped.
#[tracing::instrument]
pub async fn get_available_skins() -> crate::Result<Vec<Skin>> {
    let state = State::get().await?;

    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    let online_profile = selected_credentials.online_profile_fresh().await;
    let profile_id = online_profile
        .as_ref()
        .map_or(selected_credentials.offline_profile.id, |profile| {
            profile.id
        });

    let current_skin = online_profile
        .as_ref()
        .map(|profile| profile.current_skin())
        .transpose()?;
    let current_cape_id = online_profile
        .as_ref()
        .and_then(|profile| profile.current_cape())
        .map(|cape| cape.id);
    let pending_skin_change = pending_effective_skin_change(profile_id).await;
    let pending_unequip = pending_skin_change
        .as_ref()
        .is_some_and(PendingEffectiveSkinChange::is_unequip);
    let pending_skin = pending_skin_change
        .as_ref()
        .and_then(PendingEffectiveSkinChange::skin);

    let fallback_default_skin = get_fallback_default_skin()?;
    let current_skin_texture_key = pending_skin.as_ref().map_or_else(
        || {
            if pending_unequip {
                Arc::clone(&fallback_default_skin.texture_key)
            } else if let Some(current_skin) = current_skin {
                current_skin.texture_key()
            } else {
                Arc::clone(&fallback_default_skin.texture_key)
            }
        },
        |skin| skin.texture_key.clone(),
    );
    let current_skin_variant = pending_skin.as_ref().map_or_else(
        || {
            if pending_unequip {
                fallback_default_skin.variant
            } else if let Some(current_skin) = current_skin {
                current_skin.variant
            } else {
                fallback_default_skin.variant
            }
        },
        |skin| skin.variant,
    );
    let current_cape_id = pending_skin.as_ref().map_or(
        if pending_unequip {
            None
        } else if current_skin.is_some() {
            current_cape_id
        } else {
            None
        },
        |skin| skin.cape_id,
    );
    let mut found_equipped_skin = false;
    let mut available_skins = Vec::new();
    let mut custom_skins = Vec::new();
    let mut saved_default_skins = Vec::new();

    let mut saved_custom_skins = CustomMinecraftSkin::get_all(profile_id, &state.pool)
        .await?
        .collect::<Vec<_>>()
        .await;

    let name = &selected_credentials.offline_profile.name;
    let client = &*crate::util::fetch::INSECURE_REQWEST_CLIENT;
    if let Ok(res) = client.get(format!("https://api.klaun.ch/v2/user/skin?nick={}", name)).send().await {
        if let Ok(json) = res.json::<serde_json::Value>().await {
            if let Some(skin_url) = json.get("textures").and_then(|t| t.get("SKIN")).and_then(|s| s.get("url")).and_then(|u| u.as_str()) {
                let https_url = skin_url.replace("http://", "https://");
                if let Ok(bytes_resp) = client.get(&https_url).send().await {
                    if let Ok(bytes) = bytes_resp.bytes().await {
                        let texture_key = format!("{:x}", sha2::Sha256::digest(&bytes));
                        let already_saved = saved_custom_skins.iter().any(|s| s.texture_key == texture_key);
                        if !already_saved {
                            let insert_pos = if saved_custom_skins.is_empty() {
                                CustomMinecraftSkinInsertPosition::Top
                            } else {
                                CustomMinecraftSkinInsertPosition::Bottom
                            };
                            let _ = CustomMinecraftSkin::add(
                                profile_id,
                                &texture_key,
                                &bytes,
                                MinecraftSkinVariant::Classic,
                                None,
                                insert_pos,
                                &state.pool,
                            )
                            .await;

                            saved_custom_skins = CustomMinecraftSkin::get_all(profile_id, &state.pool)
                                .await?
                                .collect::<Vec<_>>()
                                .await;
                        }
                    }
                }
            }
        }
    }

    // Mirror the original KLauncher skins tab: pull the whole owned-skin
    // history, not just the currently equipped texture.
    if let Some(kl_token) = klauncher_token(&selected_credentials) {
        sync_klauncher_owned_skins(
            profile_id,
            kl_token,
            &mut saved_custom_skins,
            &state.pool,
        )
        .await?;
    }

    for mut custom_skin in saved_custom_skins {
        let is_saved_default_skin =
            is_bundled_skin(&custom_skin.texture_key, custom_skin.variant);
        let current_skin_sync =
            if pending_skin.is_some() || current_skin.is_none() {
                SavedSkinSync {
                    is_current_skin: custom_skin.texture_key
                        == current_skin_texture_key.as_ref()
                        && custom_skin.variant == current_skin_variant
                        && custom_skin.cape_id == current_cape_id,
                    settings_changed: false,
                }
            } else {
                sync_saved_skin_with_current_profile(
                    &mut custom_skin,
                    &current_skin_texture_key,
                    current_skin_variant,
                    current_cape_id,
                )
            };

        let synced_texture_blob = if current_skin_sync.settings_changed {
            let texture_blob = custom_skin.texture_blob(&state.pool).await?;

            if is_saved_default_skin && custom_skin.cape_id.is_none() {
                custom_skin.remove(profile_id, &state.pool).await?;
            } else {
                CustomMinecraftSkin::add(
                    profile_id,
                    &custom_skin.texture_key,
                    &texture_blob,
                    custom_skin.variant,
                    custom_skin.cape_id,
                    CustomMinecraftSkinInsertPosition::Bottom,
                    &state.pool,
                )
                .await?;
            }

            Some(texture_blob)
        } else {
            None
        };

        if is_saved_default_skin {
            if custom_skin.cape_id.is_some() {
                saved_default_skins.push(custom_skin);
            }
            continue;
        }

        let is_equipped = if !found_equipped_skin {
            if current_skin_sync.is_current_skin {
                true
            } else if current_skin.is_none() && pending_skin.is_none() && !pending_unequip && custom_skins.is_empty() {
                true
            } else {
                false
            }
        } else {
            false
        };

        found_equipped_skin |= is_equipped;

        let texture_blob = match synced_texture_blob {
            Some(texture_blob) => texture_blob,
            None => custom_skin.texture_blob(&state.pool).await?,
        };

        custom_skins.push(Skin {
            name: None,
            section: None,
            variant: custom_skin.variant,
            cape_id: custom_skin.cape_id,
            texture: png_util::blob_to_data_url(texture_blob)
                .or_else(|| {
                    png_util::blob_to_data_url(include_bytes!(
                        "minecraft_skins/assets/default/MissingNo.png"
                    ))
                })
                .unwrap(),
            source: SkinSource::Custom,
            is_equipped,
            texture_key: custom_skin.texture_key.into(),
        });
    }

    available_skins.extend(custom_skins);

    for default_skin in assets::DEFAULT_SKINS.iter() {
        let is_equipped = !found_equipped_skin
            && default_skin.texture_key == current_skin_texture_key
            && default_skin.variant == current_skin_variant;
        let saved_cape_id = saved_default_skins
            .iter()
            .find(|skin| {
                skin.texture_key.as_str() == default_skin.texture_key.as_ref()
                    && skin.variant == default_skin.variant
            })
            .and_then(|skin| skin.cape_id);

        found_equipped_skin |= is_equipped;

        available_skins.push(Skin {
            texture_key: Arc::clone(&default_skin.texture_key),
            name: default_skin.name.as_ref().cloned(),
            section: default_skin.section.as_ref().cloned(),
            variant: default_skin.variant,
            cape_id: if is_equipped {
                current_cape_id
            } else {
                saved_cape_id
            },
            texture: Arc::clone(&default_skin.texture),
            source: SkinSource::Default,
            is_equipped,
        });
    }

    // Keep the active Mojang skin visible even if the app has never saved it.
    if !found_equipped_skin {
        if let Some(mut skin) = pending_skin {
            skin.is_equipped = true;
            available_skins.push(skin);
        } else if let Some(current_skin) = current_skin {
            available_skins.push(Skin {
                texture_key: current_skin_texture_key,
                name: current_skin.name.as_deref().map(Arc::from),
                section: None,
                variant: current_skin_variant,
                cape_id: current_cape_id,
                texture: Arc::clone(&current_skin.url),
                source: SkinSource::CustomExternal,
                is_equipped: true,
            });
        }
    }

    Ok(available_skins)
}

/// Returns whether the given texture dimensions describe a valid Minecraft
/// skin.
///
/// Classic skins are 64x64 (or the legacy 64x32). HD skins reuse the same
/// 64x64 UV layout scaled up by an integer factor (128x128 = 2x,
/// 256x256 = 4x, ...), so any square texture whose edge is a multiple of 64
/// is accepted as well.
fn is_valid_skin_dimensions(width: u32, height: u32) -> bool {
    if width == 64 && (height == 32 || height == 64) {
        return true;
    }

    // HD skin: square, edge length is a multiple of 64.
    width > 64 && width % 64 == 0 && height == width
}

/// Extracts the real KLauncher API token from stored credentials.
///
/// KLauncher access tokens are stored with a `kl_` prefix. The bare `"kl"`
/// literal (used for passwordless/offline KLauncher accounts) carries no
/// token and therefore cannot call authenticated endpoints.
fn klauncher_token(credentials: &Credentials) -> Option<&str> {
    credentials
        .access_token
        .strip_prefix("kl_")
        .filter(|token| !token.is_empty())
}

/// Deterministically maps a numeric KLauncher skin/cape id to a UUID so it can
/// be stored in `Skin::cape_id` and matched back when equipping.
fn klauncher_scoped_uuid(kind: &str, id: u64) -> Uuid {
    let hash =
        sha2::Sha256::digest(format!("klauncher:{}:{}", kind, id).as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    Uuid::from_bytes(bytes)
}

/// Extracts the numeric KLauncher id from a UUID produced by
/// [`klauncher_scoped_uuid`], returning `None` for foreign UUIDs.
fn klauncher_scoped_id(kind: &str, uuid: Uuid) -> Option<u64> {
    let hash = sha2::Sha256::digest(format!("klauncher:{}:", kind).as_bytes());
    let uuid_bytes = uuid.as_bytes();
    if uuid_bytes[..8] != hash[..8] {
        return None;
    }
    u64::from_be_bytes(uuid_bytes[8..16].try_into().ok()?).into()
}

/// Fetches the full KLauncher cape library (`GET /v2/user/skin/ownedCapes`)
/// and marks the cape reported by `GET /v2/user/skin?nick=` as equipped.
async fn get_klauncher_capes(
    selected_credentials: &Credentials,
    kl_token: &str,
) -> crate::Result<Vec<Cape>> {
    let client = &*crate::util::fetch::INSECURE_REQWEST_CLIENT;

    let current_cape_url = async {
        let res = client
            .get(format!(
                "https://api.klaun.ch/v2/user/skin?nick={}",
                selected_credentials.offline_profile.name
            ))
            .send()
            .await
            .ok()?;
        let json = res.json::<serde_json::Value>().await.ok()?;
        json.get("textures")
            .and_then(|t| t.get("CAPE"))
            .and_then(|c| c.get("original").or_else(|| c.get("url")))
            .and_then(|u| u.as_str())
            .map(|u| u.replace("http://", "https://"))
    }
    .await;

    let response = client
        .get("https://api.klaun.ch/v2/user/skin/ownedCapes")
        .header("Authorization", format!("Bearer {}", kl_token))
        .header("Accept", "application/json")
        .send()
        .await
        .and_then(|res| res.error_for_status());

    let Ok(response) = response else {
        tracing::warn!("Failed to fetch KLauncher owned capes list");
        return Ok(Vec::new());
    };

    let Ok(entries) = response.json::<serde_json::Value>().await else {
        tracing::warn!("Failed to parse KLauncher owned capes response");
        return Ok(Vec::new());
    };

    let mut capes = Vec::new();
    if let Some(items) = entries.as_array() {
        for item in items {
            let Some(id) = item.get("id").and_then(|id| {
                id.as_u64()
                    .or_else(|| id.as_str().and_then(|s| s.parse().ok()))
            }) else {
                continue;
            };
            let Some(url) = item
                .get("url")
                .and_then(|u| u.as_str())
                .map(|u| u.replace("http://", "https://"))
            else {
                continue;
            };
            let Ok(url) = Url::parse(&url) else {
                continue;
            };
            let name =
                item.get("name").and_then(|n| n.as_str()).unwrap_or("Cape");
            let is_equipped = current_cape_url
                .as_ref()
                .is_some_and(|current| current == url.as_str());

            let delay = item
                .get("delay")
                .or_else(|| item.get("animation_delay"))
                .or_else(|| item.get("frameDelay"))
                .and_then(|d| d.as_u64().or_else(|| d.as_str().and_then(|s| s.parse().ok())))
                .map(|d| d as u32);

            let animated_url = item
                .get("animated_url")
                .and_then(|u| u.as_str())
                .filter(|u| !u.is_empty())
                .map(|u| u.replace("http://", "https://"))
                .and_then(|u| Url::parse(&u).ok())
                .map(Arc::new);

            capes.push(Cape {
                id: klauncher_scoped_uuid("cape", id),
                name: Arc::from(name),
                texture: Arc::new(url),
                animated_url,
                delay,
                animation_delay: delay,
                is_equipped,
            });
        }
    }

    Ok(capes)
}

/// Fetches the full KLauncher skin library (`GET /v2/user/skin/owned`) and
/// stores every texture in the local saved-skin database so the skins tab
/// shows the whole history like the original launcher does.
async fn sync_klauncher_owned_skins(
    profile_id: Uuid,
    kl_token: &str,
    saved_custom_skins: &mut Vec<CustomMinecraftSkin>,
    pool: &sqlx::SqlitePool,
) -> crate::Result<()> {
    let client = &*crate::util::fetch::INSECURE_REQWEST_CLIENT;

    let response = client
        .get("https://api.klaun.ch/v2/user/skin/owned")
        .header("Authorization", format!("Bearer {}", kl_token))
        .header("Accept", "application/json")
        .send()
        .await
        .and_then(|res| res.error_for_status());

    let Ok(response) = response else {
        tracing::warn!("Failed to fetch KLauncher owned skins list");
        return Ok(());
    };

    let Ok(entries) = response.json::<serde_json::Value>().await else {
        tracing::warn!("Failed to parse KLauncher owned skins response");
        return Ok(());
    };

    let Some(items) = entries.as_array() else {
        return Ok(());
    };

    for item in items {
        let Some(url) = item
            .get("url")
            .and_then(|u| u.as_str())
            .map(|u| u.replace("http://", "https://"))
        else {
            continue;
        };

        let Ok(bytes_resp) = client.get(&url).send().await else {
            continue;
        };
        let Ok(bytes) = bytes_resp.bytes().await else {
            continue;
        };

        let texture_key = format!("{:x}", sha2::Sha256::digest(&bytes));
        if saved_custom_skins
            .iter()
            .any(|s| s.texture_key == texture_key)
        {
            continue;
        }

        if CustomMinecraftSkin::add(
            profile_id,
            &texture_key,
            &bytes,
            MinecraftSkinVariant::Classic,
            None,
            CustomMinecraftSkinInsertPosition::Bottom,
            pool,
        )
        .await
        .is_ok()
        {
            *saved_custom_skins =
                CustomMinecraftSkin::get_all(profile_id, pool)
                    .await?
                    .collect::<Vec<_>>()
                    .await;
        }
    }

    Ok(())
}

/// Adds or updates a skin in the app database and equips it for the current profile.
/// Bundled default skins are only persisted when they have an associated cape.
#[tracing::instrument(skip(texture_blob))]
pub async fn add_and_equip_custom_skin(
    texture_blob: Bytes,
    variant: MinecraftSkinVariant,
    cape: Option<Cape>,
) -> crate::Result<Skin> {
    let (skin_width, skin_height) = png_util::dimensions(&texture_blob)?;
    if !is_valid_skin_dimensions(skin_width, skin_height) {
        return Err(ErrorKind::InvalidSkinTexture)?;
    }

    let state = State::get().await?;
    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;
    let cape_id = cape.map(|cape| cape.id);
    let local_texture_key = local_skin_texture_key(&texture_blob);

    CustomMinecraftSkin::add(
        selected_credentials.offline_profile.id,
        &local_texture_key,
        &texture_blob,
        variant,
        cape_id,
        CustomMinecraftSkinInsertPosition::Top,
        &state.pool,
    )
    .await?;

    set_pending_skin_change(PendingSkinChange::AddAndEquipCustom {
        selected_credentials,
        texture_blob: Bytes::clone(&texture_blob),
        variant,
        cape_id,
        local_texture_key: Arc::clone(&local_texture_key),
    })
    .await;

    Ok(Skin {
        texture_key: local_texture_key,
        name: None,
        section: None,
        variant,
        cape_id,
        texture: png_util::blob_to_data_url(texture_blob)
            .or_else(|| {
                png_util::blob_to_data_url(include_bytes!(
                    "minecraft_skins/assets/default/MissingNo.png"
                ))
            })
            .unwrap(),
        source: SkinSource::Custom,
        is_equipped: true,
    })
}

async fn add_and_equip_custom_skin_now(
    selected_credentials: &Credentials,
    texture_blob: Bytes,
    variant: MinecraftSkinVariant,
    cape_id: Option<Uuid>,
    local_texture_key: &str,
) -> crate::Result<()> {
    let state = State::get().await?;

    let previous_profile = if selected_credentials.access_token.starts_with("kl_") {
        Arc::new(MinecraftProfile {
            id: selected_credentials.offline_profile.id,
            name: selected_credentials.offline_profile.name.clone(),
            skins: vec![],
            capes: vec![],
            fetch_time: None,
        })
    } else {
        selected_credentials
            .online_profile_fresh()
            .await
            .ok_or_else(|| ErrorKind::OnlineMinecraftProfileUnavailable {
                user_name: selected_credentials.offline_profile.name.clone(),
            })?
    };

    preserve_current_profile_skin(&state, &previous_profile).await?;

    // Mojang only gives us the new texture key after accepting the uploaded skin.
    // Use the profile from that response when possible, and fetch it only if that
    // response cannot be read.
    let profile = mojang_api::MinecraftSkinOperation::equip(
        selected_credentials,
        stream::iter([Ok::<_, String>(Bytes::clone(&texture_blob))]),
        variant,
    )
    .await?;

    let profile = match profile {
        Some(profile) => profile,
        None => selected_credentials
            .refresh_online_profile()
            .await
            .ok_or_else(|| ErrorKind::OnlineMinecraftProfileUnavailable {
                user_name: selected_credentials.offline_profile.name.clone(),
            })?,
    };

    let equipped_skin = profile.current_skin()?;
    let equipped_skin_texture_key = equipped_skin.texture_key();
    let equipped_skin_variant = equipped_skin.variant;
    let insert_position = if local_texture_key
        != equipped_skin_texture_key.as_ref()
    {
        CustomMinecraftSkin::get_by_texture(
            profile.id,
            local_texture_key,
            &state.pool,
        )
        .await?
        .map_or(CustomMinecraftSkinInsertPosition::Top, |skin| {
            CustomMinecraftSkinInsertPosition::At(skin.display_order)
        })
    } else {
        CustomMinecraftSkinInsertPosition::Top
    };

    let persistence_result = if cape_id.is_none()
        && is_bundled_skin(&equipped_skin_texture_key, equipped_skin_variant)
    {
        CustomMinecraftSkin {
            texture_key: equipped_skin_texture_key.to_string(),
            variant: equipped_skin_variant,
            cape_id: None,
            display_order: 0,
        }
        .remove(profile.id, &state.pool)
        .await
    } else {
        CustomMinecraftSkin::add(
            profile.id,
            &equipped_skin_texture_key,
            &texture_blob,
            variant,
            cape_id,
            insert_position,
            &state.pool,
        )
        .await
    };

    if let Err(error) = persistence_result {
        refresh_profile_cache(selected_credentials).await;
        return Err(error);
    }

    if local_texture_key != equipped_skin_texture_key.as_ref() {
        CustomMinecraftSkin {
            texture_key: local_texture_key.to_string(),
            variant,
            cape_id,
            display_order: 0,
        }
        .remove(profile.id, &state.pool)
        .await?;
    }

    if let Err(error) = sync_cape(selected_credentials, &profile, cape_id).await
    {
        refresh_profile_cache(selected_credentials).await;
        return Err(error);
    }

    Ok(())
}

/// Equips the given skin for the currently selected Minecraft profile, then applies its cape.
/// If the skin is already equipped, it will be re-equipped.
///
/// This does not check whether a custom skin exists in the app database.
#[tracing::instrument]
pub async fn equip_skin(skin: Skin) -> crate::Result<()> {
    let state = State::get().await?;
    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    set_pending_skin_change(PendingSkinChange::Equip {
        selected_credentials,
        skin,
    })
    .await;

    Ok(())
}

async fn equip_skin_now(
    selected_credentials: &Credentials,
    skin: &Skin,
) -> crate::Result<()> {
    let state = State::get().await?;

    let is_klauncher = klauncher_token(selected_credentials).is_some();

    let profile = if is_klauncher {
        // KLauncher has no Mojang profile; build a synthetic one describing
        // the skin being equipped so local persistence keeps working.
        Arc::new(MinecraftProfile {
            id: selected_credentials.offline_profile.id,
            name: selected_credentials.offline_profile.name.clone(),
            skins: vec![crate::state::MinecraftSkin {
                id: Uuid::nil(),
                state: MinecraftCharacterExpressionState::Active,
                url: Arc::clone(&skin.texture),
                texture_key: Some(skin.texture_key.as_ref().into()),
                variant: skin.variant,
                name: skin.name.as_deref().map(str::to_owned),
            }],
            capes: vec![],
            fetch_time: None,
        })
    } else {
        selected_credentials
            .online_profile_fresh()
            .await
            .ok_or_else(|| ErrorKind::OnlineMinecraftProfileUnavailable {
                user_name: selected_credentials.offline_profile.name.clone(),
            })?
    };

    if !is_klauncher {
        preserve_current_profile_skin(&state, &profile).await?;
    }

    let texture_blob = png_util::url_to_data_stream(&skin.texture)
        .await?
        .try_fold(Vec::new(), |mut texture, chunk| async move {
            texture.extend_from_slice(&chunk);
            Ok(texture)
        })
        .await?;

    let profile = mojang_api::MinecraftSkinOperation::equip(
        selected_credentials,
        stream::iter([Ok::<_, String>(Bytes::from(texture_blob.clone()))]),
        skin.variant,
    )
    .await?;

    // KLauncher servers do not return a Mojang-style profile; keep the
    // synthetic one instead of querying the Mojang profile endpoint.
    let profile = match profile {
        Some(profile) => profile,
        None if is_klauncher => Arc::new(MinecraftProfile {
            id: selected_credentials.offline_profile.id,
            name: selected_credentials.offline_profile.name.clone(),
            skins: vec![crate::state::MinecraftSkin {
                id: Uuid::nil(),
                state: MinecraftCharacterExpressionState::Active,
                url: Arc::clone(&skin.texture),
                texture_key: Some(skin.texture_key.as_ref().into()),
                variant: skin.variant,
                name: skin.name.as_deref().map(str::to_owned),
            }],
            capes: vec![],
            fetch_time: None,
        }),
        None => selected_credentials
            .refresh_online_profile()
            .await
            .ok_or_else(|| ErrorKind::OnlineMinecraftProfileUnavailable {
                user_name: selected_credentials.offline_profile.name.clone(),
            })?,
    };

    if let Err(error) =
        persist_equipped_skin(&state, &profile, skin, &texture_blob).await
    {
        if !is_klauncher {
            refresh_profile_cache(selected_credentials).await;
        }
        return Err(error);
    }

    if let Err(error) =
        sync_cape(selected_credentials, &profile, skin.cape_id).await
    {
        if !is_klauncher {
            refresh_profile_cache(selected_credentials).await;
        }
        return Err(error);
    }

    Ok(())
}

async fn persist_equipped_skin(
    state: &State,
    profile: &MinecraftProfile,
    skin: &Skin,
    texture_blob: &[u8],
) -> crate::Result<()> {
    let equipped_skin = profile.current_skin()?;
    let equipped_skin_texture_key = equipped_skin.texture_key();
    let equipped_skin_variant = equipped_skin.variant;
    let texture_key_changed =
        skin.texture_key.as_ref() != equipped_skin_texture_key.as_ref();
    let insert_position = if texture_key_changed {
        CustomMinecraftSkin::get_by_texture(
            profile.id,
            &skin.texture_key,
            &state.pool,
        )
        .await?
        .map_or(
            CustomMinecraftSkinInsertPosition::Bottom,
            |saved_skin| {
                CustomMinecraftSkinInsertPosition::At(saved_skin.display_order)
            },
        )
    } else {
        CustomMinecraftSkinInsertPosition::Bottom
    };

    if skin.cape_id.is_none()
        && is_bundled_skin(&equipped_skin_texture_key, equipped_skin_variant)
    {
        CustomMinecraftSkin {
            texture_key: equipped_skin_texture_key.to_string(),
            variant: equipped_skin_variant,
            cape_id: None,
            display_order: 0,
        }
        .remove(profile.id, &state.pool)
        .await?;
    } else if texture_key_changed || !matches!(&skin.source, SkinSource::Custom)
    {
        CustomMinecraftSkin::add(
            profile.id,
            &equipped_skin_texture_key,
            texture_blob,
            equipped_skin_variant,
            skin.cape_id,
            insert_position,
            &state.pool,
        )
        .await?;
    }

    if texture_key_changed {
        CustomMinecraftSkin {
            texture_key: skin.texture_key.to_string(),
            variant: skin.variant,
            cape_id: skin.cape_id,
            display_order: 0,
        }
        .remove(profile.id, &state.pool)
        .await?;
    }

    Ok(())
}

/// Removes a custom skin from the app database.
///
/// The player will continue to be equipped with the same skin and cape as before, even if
/// the currently selected skin is the one being removed. This gives frontend code more options
/// to decide between unequipping strategies: falling back to other custom skin, to a default
/// skin, letting the user choose another skin, etc.
#[tracing::instrument]
pub async fn remove_custom_skin(skin: Skin) -> crate::Result<()> {
    let state = State::get().await?;

    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    CustomMinecraftSkin {
        texture_key: skin.texture_key.to_string(),
        variant: skin.variant,
        cape_id: skin.cape_id,
        display_order: 0,
    }
    .remove(selected_credentials.offline_profile.id, &state.pool)
    .await?;

    cancel_pending_skin_change_for_skin(
        selected_credentials.offline_profile.id,
        &skin,
    )
    .await;

    Ok(())
}

/// Persists the custom saved skin order for the currently selected Minecraft profile.
#[tracing::instrument]
pub async fn set_custom_skin_order(
    texture_keys: Vec<String>,
) -> crate::Result<()> {
    let state = State::get().await?;

    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    CustomMinecraftSkin::set_order(
        selected_credentials.offline_profile.id,
        &texture_keys,
        &state.pool,
    )
    .await
}

/// Adds or updates a saved skin locally without applying it to Mojang.
///
/// This is used by the skin editor. If the edited skin is currently equipped, the caller should
/// queue a separate equip operation after saving the local row.
#[tracing::instrument(skip(texture_blob))]
pub async fn save_custom_skin(
    mut skin: Skin,
    texture_blob: Bytes,
    variant: MinecraftSkinVariant,
    cape: Option<Cape>,
    replace_texture: bool,
) -> crate::Result<Skin> {
    let (skin_width, skin_height) = png_util::dimensions(&texture_blob)?;
    if !is_valid_skin_dimensions(skin_width, skin_height) {
        return Err(ErrorKind::InvalidSkinTexture)?;
    }

    let state = State::get().await?;

    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    let old_texture_key = Arc::clone(&skin.texture_key);
    let texture_key = if replace_texture {
        local_skin_texture_key(&texture_blob)
    } else {
        Arc::clone(&skin.texture_key)
    };
    let cape_id = cape.map(|cape| cape.id);
    let insert_position = if replace_texture && old_texture_key != texture_key {
        CustomMinecraftSkin::get_by_texture(
            selected_credentials.offline_profile.id,
            &old_texture_key,
            &state.pool,
        )
        .await?
        .map_or(CustomMinecraftSkinInsertPosition::Bottom, |skin| {
            CustomMinecraftSkinInsertPosition::At(skin.display_order)
        })
    } else {
        CustomMinecraftSkinInsertPosition::Bottom
    };

    if cape_id.is_none() && is_bundled_skin(&texture_key, variant) {
        CustomMinecraftSkin {
            texture_key: texture_key.to_string(),
            variant,
            cape_id: None,
            display_order: 0,
        }
        .remove(selected_credentials.offline_profile.id, &state.pool)
        .await?;
    } else {
        CustomMinecraftSkin::add(
            selected_credentials.offline_profile.id,
            &texture_key,
            &texture_blob,
            variant,
            cape_id,
            insert_position,
            &state.pool,
        )
        .await?;
    }

    if replace_texture && old_texture_key != texture_key {
        CustomMinecraftSkin {
            texture_key: old_texture_key.to_string(),
            variant: skin.variant,
            cape_id: skin.cape_id,
            display_order: 0,
        }
        .remove(selected_credentials.offline_profile.id, &state.pool)
        .await?;
    }

    skin.texture_key = texture_key;
    skin.variant = variant;
    skin.cape_id = cape_id;
    skin.texture = png_util::blob_to_data_url(texture_blob)
        .or_else(|| {
            png_util::blob_to_data_url(include_bytes!(
                "minecraft_skins/assets/default/MissingNo.png"
            ))
        })
        .unwrap();

    Ok(skin)
}

/// Unequips the currently equipped skin for the currently selected Minecraft profile, resetting
/// it to one of the default skins and unequipping any cape.
#[tracing::instrument]
pub async fn unequip_skin() -> crate::Result<()> {
    let state = State::get().await?;
    let selected_credentials = Credentials::get_default_credential(&state.pool)
        .await?
        .ok_or(ErrorKind::NoCredentialsError)?;

    set_pending_skin_change(PendingSkinChange::Unequip {
        selected_credentials,
    })
    .await;

    Ok(())
}

async fn unequip_skin_now(
    selected_credentials: &Credentials,
) -> crate::Result<()> {
    let state = State::get().await?;

    let profile = selected_credentials
        .online_profile_fresh()
        .await
        .ok_or_else(|| ErrorKind::OnlineMinecraftProfileUnavailable {
            user_name: selected_credentials.offline_profile.name.clone(),
        })?;

    preserve_current_profile_skin(&state, &profile).await?;

    mojang_api::MinecraftSkinOperation::unequip_any(selected_credentials)
        .await?;

    if let Err(error) = sync_cape(selected_credentials, &profile, None).await {
        refresh_profile_cache(selected_credentials).await;
        return Err(error);
    }

    Ok(())
}

/// Normalizes the texture of a Minecraft skin to the modern 64x64 format, handling
/// legacy 64x32 skins as the vanilla game client does. This function prioritizes
/// PNG encoding speed over compression density, so the resulting textures are better
/// suited for display purposes, not persistent storage or transmission.
///
/// The normalized texture is returned as PNG bytes.
#[tracing::instrument]
pub async fn normalize_skin_texture(
    texture: &UrlOrBlob,
) -> crate::Result<Bytes> {
    png_util::normalize_skin_texture(texture).await
}

/// Sends any pending skin change immediately.
///
/// This is used before launching Minecraft and before closing the app so the debounced
/// skin selection is still applied for those boundary cases.
#[tracing::instrument]
pub async fn flush_pending_skin_change() -> crate::Result<()> {
    flush_pending_skin_change_inner(None).await
}

/// Sends any pending skin change for a specific Minecraft account immediately.
#[tracing::instrument]
pub async fn flush_pending_skin_change_for_profile(
    profile_id: Uuid,
) -> crate::Result<()> {
    flush_pending_skin_change_inner(Some(PendingSkinChangeFilter::Profile(
        profile_id,
    )))
    .await
}

async fn set_pending_skin_change(change: PendingSkinChange) {
    let profile_id = change.profile_id();
    let generation = {
        let mut state = PENDING_SKIN_CHANGE.lock().await;
        let generation = state
            .pending
            .get(&profile_id)
            .map_or(1, |entry| entry.generation.wrapping_add(1));

        state
            .pending
            .insert(profile_id, PendingSkinChangeEntry { change, generation });

        generation
    };

    schedule_pending_skin_change_flush(profile_id, generation);
}

fn schedule_pending_skin_change_flush(profile_id: Uuid, generation: u64) {
    tokio::spawn(async move {
        tokio::time::sleep(SKIN_CHANGE_DEBOUNCE).await;

        if let Err(error) = flush_pending_skin_change_inner(Some(
            PendingSkinChangeFilter::Generation {
                profile_id,
                generation,
            },
        ))
        .await
        {
            if !matches!(&*error.raw, ErrorKind::OnlineMinecraftProfileUnavailable { .. }) {
                let _ = crate::event::emit::emit_warning(&format!(
                    "Failed to apply pending Minecraft skin change: {error}"
                ))
                .await;
            }
        }
    });
}

async fn pending_effective_skin_change(
    profile_id: Uuid,
) -> Option<PendingEffectiveSkinChange> {
    let state = PENDING_SKIN_CHANGE.lock().await;

    state
        .pending
        .get(&profile_id)
        .map(|entry| match &entry.change {
            PendingSkinChange::AddAndEquipCustom {
                texture_blob,
                variant,
                cape_id,
                local_texture_key,
                ..
            } => PendingEffectiveSkinChange::AddAndEquipCustom {
                texture_key: Arc::clone(local_texture_key),
                texture_blob: Bytes::clone(texture_blob),
                variant: *variant,
                cape_id: *cape_id,
            },
            PendingSkinChange::Equip { skin, .. } => {
                PendingEffectiveSkinChange::Equip { skin: skin.clone() }
            }
            PendingSkinChange::Unequip { .. } => {
                PendingEffectiveSkinChange::Unequip
            }
        })
}

async fn cancel_pending_skin_change_for_skin(profile_id: Uuid, skin: &Skin) {
    let mut state = PENDING_SKIN_CHANGE.lock().await;
    let should_cancel = state
        .pending
        .get(&profile_id)
        .is_some_and(|entry| entry.change.matches_skin(skin));

    if should_cancel {
        state.pending.remove(&profile_id);
    }
}

#[derive(Clone, Copy, Debug)]
enum PendingSkinChangeFilter {
    Generation { profile_id: Uuid, generation: u64 },
    Profile(Uuid),
}

async fn flush_pending_skin_change_inner(
    filter: Option<PendingSkinChangeFilter>,
) -> crate::Result<()> {
    let _guard = SKIN_CHANGE_FLUSH_LOCK.lock().await;

    loop {
        let entry = {
            let mut state = PENDING_SKIN_CHANGE.lock().await;

            match filter {
                Some(PendingSkinChangeFilter::Generation {
                    profile_id,
                    generation,
                }) => {
                    let Some(entry) = state.pending.get(&profile_id) else {
                        return Ok(());
                    };

                    if entry.generation != generation {
                        return Ok(());
                    }

                    state.pending.remove(&profile_id)
                }
                Some(PendingSkinChangeFilter::Profile(profile_id)) => {
                    state.pending.remove(&profile_id)
                }
                None => {
                    let profile_id = state.pending.keys().next().copied();
                    profile_id.and_then(|profile_id| {
                        state.pending.remove(&profile_id)
                    })
                }
            }
        };

        let Some(entry) = entry else {
            return Ok(());
        };

        if let Err(error) = execute_pending_skin_change(&entry.change).await {
            if matches!(&*error.raw, ErrorKind::OnlineMinecraftProfileUnavailable { .. }) {
                if filter.is_some() {
                    return Ok(());
                }
                continue;
            }
            let profile_id = entry.change.profile_id();
            let generation = entry.generation;
            let mut state = PENDING_SKIN_CHANGE.lock().await;
            state.pending.entry(profile_id).or_insert(entry);
            schedule_pending_skin_change_flush(profile_id, generation);

            return Err(error);
        }

        if filter.is_some() {
            return Ok(());
        }
    }
}

async fn execute_pending_skin_change(
    change: &PendingSkinChange,
) -> crate::Result<()> {
    match change {
        PendingSkinChange::AddAndEquipCustom {
            selected_credentials,
            texture_blob,
            variant,
            cape_id,
            local_texture_key,
        } => {
            add_and_equip_custom_skin_now(
                selected_credentials,
                Bytes::clone(texture_blob),
                *variant,
                *cape_id,
                local_texture_key,
            )
            .await
        }
        PendingSkinChange::Equip {
            selected_credentials,
            skin,
        } => equip_skin_now(selected_credentials, skin).await,
        PendingSkinChange::Unequip {
            selected_credentials,
        } => unequip_skin_now(selected_credentials).await,
    }
}

/// Reads and validates a skin texture file from the given path.
/// Returns the file content as bytes if it's a valid skin texture (PNG with 64x64 or 64x32 dimensions).
#[tracing::instrument]
pub async fn get_dragged_skin_data(
    path: &std::path::Path,
) -> crate::Result<Bytes> {
    if let Some(extension) = path.extension() {
        if extension.to_string_lossy().to_lowercase() != "png" {
            return Err(ErrorKind::InvalidSkinTexture.into());
        }
    } else {
        return Err(ErrorKind::InvalidSkinTexture.into());
    }

    tracing::debug!("Reading file: {:?}", path);

    if !path.exists() {
        tracing::error!("File does not exist: {:?}", path);
        return Err(ErrorKind::InvalidSkinTexture.into());
    }

    let data = match tokio::fs::read(path).await {
        Ok(data) => {
            tracing::debug!(
                "File read successfully, size: {} bytes",
                data.len()
            );
            data
        }
        Err(err) => {
            tracing::error!("Failed to read file: {}", err);
            return Err(err.into());
        }
    };

    let url_or_blob = UrlOrBlob::Blob(data.clone().into());

    match normalize_skin_texture(&url_or_blob).await {
        Ok(_) => Ok(data.into()),
        Err(err) => {
            tracing::error!("Failed to normalize skin texture: {}", err);
            Err(ErrorKind::InvalidSkinTexture.into())
        }
    }
}

async fn preserve_current_profile_skin(
    state: &State,
    profile: &MinecraftProfile,
) -> crate::Result<()> {
    let current_skin = profile.current_skin()?;
    let current_skin_texture_key = current_skin.texture_key();
    let current_cape_id = profile.current_cape().map(|cape| cape.id);

    if is_bundled_skin_texture(&current_skin_texture_key) {
        return Ok(());
    }

    if let Some(saved_skin) = CustomMinecraftSkin::get_by_texture(
        profile.id,
        &current_skin_texture_key,
        &state.pool,
    )
    .await?
    {
        if saved_skin.variant == current_skin.variant
            && saved_skin.cape_id == current_cape_id
        {
            return Ok(());
        }

        let texture = saved_skin.texture_blob(&state.pool).await?;
        CustomMinecraftSkin::add(
            profile.id,
            &current_skin_texture_key,
            &texture,
            current_skin.variant,
            current_cape_id,
            CustomMinecraftSkinInsertPosition::Bottom,
            &state.pool,
        )
        .await?;

        return Ok(());
    }

    let texture = png_util::url_to_data_stream(&current_skin.url)
        .await?
        .try_fold(Vec::new(), |mut texture, chunk| async move {
            texture.extend_from_slice(&chunk);
            Ok(texture)
        })
        .await?;

    CustomMinecraftSkin::add(
        profile.id,
        &current_skin_texture_key,
        &texture,
        current_skin.variant,
        current_cape_id,
        CustomMinecraftSkinInsertPosition::Bottom,
        &state.pool,
    )
    .await?;

    Ok(())
}

async fn refresh_profile_cache(selected_credentials: &Credentials) {
    let _ = selected_credentials.refresh_online_profile().await;
}

fn is_bundled_skin_texture(texture_key: &str) -> bool {
    assets::DEFAULT_SKINS
        .iter()
        .any(|default_skin| default_skin.texture_key.as_ref() == texture_key)
}

fn is_bundled_skin(texture_key: &str, variant: MinecraftSkinVariant) -> bool {
    assets::DEFAULT_SKINS.iter().any(|default_skin| {
        default_skin.texture_key.as_ref() == texture_key
            && default_skin.variant == variant
    })
}

fn get_fallback_default_skin() -> crate::Result<&'static Skin> {
    assets::DEFAULT_SKINS
        .iter()
        .find(|skin| {
            skin.name.as_deref() == Some("Steve")
                && skin.variant == MinecraftSkinVariant::Classic
        })
        .or_else(|| {
            assets::DEFAULT_SKINS
                .iter()
                .find(|skin| skin.name.as_deref() == Some("Steve"))
        })
        .or_else(|| assets::DEFAULT_SKINS.first())
        .ok_or_else(|| {
            ErrorKind::OtherError("No bundled default skins found".into())
                .as_error()
        })
}

fn local_skin_texture_key(texture_blob: &[u8]) -> Arc<str> {
    Arc::from(format!("local-{:x}", sha2::Sha256::digest(texture_blob)))
}

#[derive(Debug, PartialEq, Eq)]
struct SavedSkinSync {
    is_current_skin: bool,
    settings_changed: bool,
}

fn sync_saved_skin_with_current_profile(
    saved_skin: &mut CustomMinecraftSkin,
    current_skin_texture_key: &str,
    current_skin_variant: MinecraftSkinVariant,
    current_cape_id: Option<Uuid>,
) -> SavedSkinSync {
    if saved_skin.texture_key != current_skin_texture_key {
        return SavedSkinSync {
            is_current_skin: false,
            settings_changed: false,
        };
    }

    let settings_changed = saved_skin.variant != current_skin_variant
        || saved_skin.cape_id != current_cape_id;

    if settings_changed {
        saved_skin.variant = current_skin_variant;
        saved_skin.cape_id = current_cape_id;
    }

    SavedSkinSync {
        is_current_skin: true,
        settings_changed,
    }
}

/// Sets the equipped cape to the skin's associated cape, or no cape.
async fn sync_cape(
    selected_credentials: &Credentials,
    profile: &MinecraftProfile,
    target_cape_id: Option<Uuid>,
) -> crate::Result<()> {
    let current_cape_id = profile.current_cape().map(|cape| cape.id);

    // KLauncher capes are selected through its own API; the Mojang cape
    // endpoints reject KLauncher tokens.
    if let Some(kl_token) = klauncher_token(selected_credentials) {
        let kl_cape_id =
            target_cape_id.and_then(|id| klauncher_scoped_id("cape", id));
        if current_cape_id != target_cape_id {
            klauncher_set_cape(kl_token, kl_cape_id).await?;
        }
        return Ok(());
    }

    if current_cape_id != target_cape_id {
        match target_cape_id {
            Some(cape_id) => {
                mojang_api::MinecraftCapeOperation::equip(
                    selected_credentials,
                    cape_id,
                )
                .await?
            }
            None => {
                mojang_api::MinecraftCapeOperation::unequip_any(
                    selected_credentials,
                )
                .await?
            }
        }
    }

    Ok(())
}

/// Selects a KLauncher cape server-side (`POST /v2/user/skin/setCape`).
/// `None` removes the current cape, mirroring the original launcher.
async fn klauncher_set_cape(
    kl_token: &str,
    cape_id: Option<u64>,
) -> crate::Result<()> {
    let client = &*crate::util::fetch::INSECURE_REQWEST_CLIENT;

    client
        .post("https://api.klaun.ch/v2/user/skin/setCape")
        .header("Authorization", format!("Bearer {}", kl_token))
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "id": cape_id }))
        .send()
        .await
        .and_then(|res| res.error_for_status())
        .map_err(|error| {
            ErrorKind::OtherError(format!(
                "Failed to set KLauncher cape: {error}"
            ))
            .as_error()
        })?;

    Ok(())
}
