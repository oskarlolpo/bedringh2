use std::error::Error;
#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let resp = reqwest::get("https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx/secured").await;
    println!("{:#?}", resp);
    Ok(())
}
