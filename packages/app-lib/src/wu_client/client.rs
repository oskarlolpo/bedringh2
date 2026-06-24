use reqwest::{Client, header};
use tracing::debug;
use std::time::Duration;
use tokio::time::sleep;

use crate::wu_client::protocol::{WuDownloadFile, WuProtocol};
use crate::error::Error;

pub struct WuClient {
    client: Client,
    protocol: WuProtocol,
}

impl WuClient {
    pub fn with_client(client: Client) -> Self {
        Self {
            client,
            protocol: WuProtocol::new(),
        }
    }

    fn preferred_download_files(files: Vec<WuDownloadFile>) -> Vec<WuDownloadFile> {
        let mut ordered = Vec::new();
        for prefer_signed in [true, false] {
            for file in files.iter() {
                let signed = file
                    .url
                    .starts_with("http://tlu.dl.delivery.mp.microsoft.com/")
                    || file
                        .url
                        .starts_with("https://tlu.dl.delivery.mp.microsoft.com/");
                if prefer_signed != signed {
                    continue;
                }
                if (file.url.starts_with("http://") || file.url.starts_with("https://"))
                    && !ordered
                        .iter()
                        .any(|existing: &WuDownloadFile| existing.url == file.url)
                {
                    ordered.push(file.clone());
                }
            }
        }
        ordered
    }

    pub async fn get_download_url(
        &self,
        update_id: &str,
        revision: &str,
    ) -> Result<String, Error> {
        let files = self.get_download_files(update_id, revision).await?;
        files
            .into_iter()
            .map(|file| file.url)
            .next()
            .ok_or_else(|| Error::OtherError("No matching url found".into()))
    }

    pub async fn get_download_urls(
        &self,
        update_id: &str,
        revision: &str,
    ) -> Result<Vec<String>, Error> {
        let files = self.get_download_files(update_id, revision).await?;
        Ok(files.into_iter().map(|file| file.url).collect())
    }

    pub async fn get_download_files(
        &self,
        update_id: &str,
        revision: &str,
    ) -> Result<Vec<WuDownloadFile>, Error> {
        let request_xml = self.protocol.build_download_request(update_id, revision);

        for attempt in 1..=3 {
            debug!("第 {} 次请求下载 URL (update_id: {})", attempt, update_id);

            let send_result = self
                .client
                .post("https://fe3.delivery.mp.microsoft.com/ClientWebService/client.asmx/secured")
                .header(header::CONTENT_TYPE, "application/soap+xml")
                .body(request_xml.clone())
                .send()
                .await;

            match send_result {
                Ok(resp) => {
                    match resp.error_for_status() {
                        Ok(valid_resp) => {
                            let xml = valid_resp.text().await?;
                            debug!("响应 XML: {}", xml);

                            let files = self.protocol.parse_download_response(&xml).map_err(|e| Error::OtherError(format!("XML Parse Error: {:?}", e)))?;
                            debug!("解析到的 URL 列表: {:?}", files);

                            let files = Self::preferred_download_files(files);
                            if !files.is_empty() {
                                return Ok(files);
                            } else {
                                if attempt == 3 {
                                    return Err(Error::OtherError("No matching url".into()));
                                }
                            }
                        }
                        Err(e) => {
                            debug!("第 {} 次请求返回错误状态: {}", attempt, e);
                            if attempt == 3 {
                                return Err(e.into());
                            }
                        }
                    }
                }
                Err(err) => {
                    debug!("第 {} 次请求失败: {}", attempt, err);
                    if attempt == 3 {
                        return Err(err.into());
                    }
                }
            }

            let backoff = 500 * attempt * attempt;
            sleep(Duration::from_millis(backoff as u64)).await;
        }

        Err(Error::OtherError("Failed to resolve update identity".into()))
    }
}
