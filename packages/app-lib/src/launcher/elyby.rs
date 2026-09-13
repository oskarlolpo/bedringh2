pub fn is_elyby_user(access_token: &str, refresh_token: &str) -> bool {
    access_token == "elyby"
        || access_token.starts_with("elyby_")
        || refresh_token == "elyby_refresh"
}

pub const ELYBY_AUTHLIB_API: &str = "https://authserver.ely.by/api/authlib-injector";
