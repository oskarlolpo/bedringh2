use reqwest::Client;

#[tokio::main]
async fn main() {
    let client = Client::new();
    let url = "http://assets1.xboxlive.com/6/d449f74e-9ff0-4ea6-82e5-21fc53f8d40d/7792d9ce-355a-493c-afbd-768f4a77c3b0/1.26.3101.0.12b6a1df-e792-4168-b7ed-4ee580f26c7d/Microsoft.MinecraftUWP_1.26.3101.0_x64__8wekyb3d8bbwe.msixvc";
    match client.head(url).send().await {
        Ok(head_resp) => {
            println!("Status: {}", head_resp.status());
            println!("Headers: {:?}", head_resp.headers());
            println!("Content-Length: {:?}", head_resp.content_length());
        }
        Err(e) => {
            println!("Error: {}", e);
        }
    }
}
