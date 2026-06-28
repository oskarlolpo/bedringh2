use std::fs;

#[derive(serde::Deserialize, Debug)]
struct GdkResponse {
    release: Option<std::collections::HashMap<String, Vec<String>>>,
    preview: Option<std::collections::HashMap<String, Vec<String>>>,
}

fn main() {
    let text = fs::read_to_string("../gdk_urls.json").unwrap();
    let json: Result<GdkResponse, _> = serde_json::from_str(&text);
    println!("{:?}", json.is_ok());
    if let Err(e) = json {
        println!("{}", e);
    }
}
