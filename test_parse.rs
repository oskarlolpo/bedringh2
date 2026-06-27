use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BedrockVersion {
    pub version: String,
    pub is_preview: bool,
    pub identifier: String,
}

#[derive(Debug, Deserialize)]
struct GdkResponse {
    release: Option<HashMap<String, Vec<String>>>,
    preview: Option<HashMap<String, Vec<String>>>,
}

fn main() {
    let gdk_text = fs::read_to_string("urls.min.json").unwrap();
    match serde_json::from_str::<GdkResponse>(&gdk_text) {
        Ok(gdk_json) => {
            println!("Success!");
            let r_len = gdk_json.release.map(|m| m.len()).unwrap_or(0);
            let p_len = gdk_json.preview.map(|m| m.len()).unwrap_or(0);
            println!("Release: {}, Preview: {}", r_len, p_len);
        },
        Err(e) => {
            println!("Error: {}", e);
        }
    }
}
