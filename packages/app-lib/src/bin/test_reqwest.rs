use std::time::Duration;
use reqwest::Method;

#[tokio::main]
async fn main() {
    println!("Testing reqwest connection to Modrinth API...");
    let client = reqwest::Client::builder()
        .tcp_keepalive(Some(Duration::from_secs(10)))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .user_agent("modrinth/theseus/1.0.0-local (Windows; support@modrinth.com)")
        .build()
        .unwrap();

    let res = client.get("https://api.modrinth.com/v2/tag/category").send().await;
    match res {
        Ok(resp) => {
            println!("Status: {}", resp.status());
            if let Ok(text) = resp.text().await {
                println!("Response length: {}", text.len());
            }
        }
        Err(e) => {
            println!("Reqwest error: {:?}", e);
        }
    }
}
