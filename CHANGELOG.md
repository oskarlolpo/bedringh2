# Changelog

## [0.0.44] - 2026-11-25

### Fixed
- **Контент-таб (моды, ресурс-паки, шейдеры):**
  - Исправлена гонка в `providers/content-install.ts` и переведена подписка событий установки с `instance_listener` на `appEvents.on('instance', ...)`, из-за чего скачанный контент оставался неактивным (`installing: true`) до перезапуска лаунчера.
  - Убрана лишняя сетевая перевалидация (`must_revalidate`) и блокировка реальных элементов через `installingBuffer` в `pages/instance/content/index.vue` после завершения установки — свежескачанный контент становится активным сразу.
- **Оффлайн-мультиплеер (LAN / Radmin VPN / ZeroTier):**
  - Добавлен встроенный локальный Yggdrasil-сервер (`127.0.0.1:<port>`) с автоматической инъекцией `authlib-injector` для оффлайн-аккаунтов (`packages/app-lib/src/launcher/bedringh.rs`, `mod.rs`), позволяющий подключаться друг к другу в LAN-мирах без ошибки «Недействительная сессия» и без внешнего хостинга.
- **Оффлайн / локальные скины:**
  - Убраны сетевые запросы на недоступный сервер `bedringh.duckdns.org:3100` при запуске игры (`packages/app-lib/src/launcher/mod.rs`, `bedringh.rs`) и смене скина (`packages/app-lib/src/api/minecraft_skins.rs`), оставлен локальный `CustomSkinLoader` + fallback `mc-heads.net`.

### Removed
- **Серверные функции, завязанные на закрытый хостинг (`bedringh.duckdns.org`):**
  - Удалены чаты и система друзей (`SocialChats.vue`, `BedringhChatThread.vue`, `BedringhFriendsList.vue`, `FriendsDrawer.vue`, `AddFriendModal.vue`, `SocialSettings.vue`, `bedringh-friends.ts`, `bedringh-play-invite.ts`), вкладка `/chats` из навигации и роутера.
  - Удалены Bedringh ID авторизация и облачная синхронизация (`BedringhAuthModal.vue`, `use-bedringh-account.ts`, `bedringh-settings-sync.ts`, `bedringh-servers-sync.ts`, `bedringh-game-accounts-sync.ts`) из `App.vue`, `AccountsCard.vue` и настроек.
  - Удалены облачные сборки / паки по коду (`BedringhCloudPackModal.vue`, `CloudPackPublishModal.vue`, `CloudPackVersionsModal.vue`, `bedringh-cloud-packs.ts`) из библиотеки, баннеров инстанса и вкладки «Поделиться» (оставлен локальный экспорт `.mrpack` и копирование списка модов).
  - Удалены Bedringh Хостинг / лобби / VDS-туннель (`Servers.vue`, `CreateHostModal.vue`, `bedringh-lobby.ts`, `bedringh-tunnel.ts`, `bedringh-network-config.ts`, `bedringh-lan-detect.ts`, `bedringh-server-categories.ts`) из боковой панели и `local-servers.ts` (локальные серверы на ПК продолжают работать автономно).
