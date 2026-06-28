use reqwest::Client;

#[derive(serde::Deserialize, Debug)]
struct GdkResponse {
    release: Option<std::collections::HashMap<String, Vec<String>>>,
    preview: Option<std::collections::HashMap<String, Vec<String>>>,
}

async fn test() {
    let client = Client::new();
    let text = client.get("https://raw.githubusercontent.com/MinecraftBedrockArchiver/GdkLinks/refs/heads/master/urls.min.json").send().await.unwrap().text().await.unwrap();
    let json: Result<GdkResponse, _> = serde_json::from_str(text.as_str());
    println!("{:?}", json.is_ok());
    if let Err(e) = json {
        println!("{}", e);
    }
}

#[tokio::main]
async fn main() {
    test().await;
}
