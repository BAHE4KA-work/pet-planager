#[cfg(target_os = "windows")]
mod platform {
    use std::{ffi::c_void, ptr};
    use url::Url;

    type Handle = *mut c_void;
    #[link(name = "winhttp")]
    unsafe extern "system" {
        fn WinHttpOpen(
            agent: *const u16,
            access: u32,
            proxy: *const u16,
            bypass: *const u16,
            flags: u32,
        ) -> Handle;
        fn WinHttpConnect(session: Handle, server: *const u16, port: u16, reserved: u32) -> Handle;
        fn WinHttpOpenRequest(
            connect: Handle,
            verb: *const u16,
            path: *const u16,
            version: *const u16,
            referrer: *const u16,
            accept: *const *const u16,
            flags: u32,
        ) -> Handle;
        fn WinHttpSendRequest(
            request: Handle,
            headers: *const u16,
            header_len: u32,
            optional: *mut c_void,
            optional_len: u32,
            total_len: u32,
            context: usize,
        ) -> i32;
        fn WinHttpReceiveResponse(request: Handle, reserved: *mut c_void) -> i32;
        fn WinHttpQueryHeaders(
            request: Handle,
            level: u32,
            name: *const u16,
            buffer: *mut c_void,
            size: *mut u32,
            index: *mut u32,
        ) -> i32;
        fn WinHttpQueryDataAvailable(request: Handle, available: *mut u32) -> i32;
        fn WinHttpReadData(request: Handle, buffer: *mut c_void, size: u32, read: *mut u32) -> i32;
        fn WinHttpSetTimeouts(
            handle: Handle,
            resolve: i32,
            connect: i32,
            send: i32,
            receive: i32,
        ) -> i32;
        fn WinHttpSetOption(handle: Handle, option: u32, buffer: *mut c_void, size: u32) -> i32;
        fn WinHttpCloseHandle(handle: Handle) -> i32;
    }

    struct H(Handle);
    impl Drop for H {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    WinHttpCloseHandle(self.0);
                }
            }
        }
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
    fn check(ok: i32, what: &str) -> Result<(), String> {
        if ok == 0 {
            Err(format!(
                "Windows HTTP {what} failed ({})",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }

    pub fn request(
        method: &str,
        url: &str,
        content_type: &str,
        headers: Vec<(String, String)>,
        body: &[u8],
    ) -> Result<(u16, Vec<u8>), String> {
        let parsed = Url::parse(url).map_err(|_| "AI provider endpoint is invalid".to_string())?;
        if !matches!(parsed.scheme(), "https" | "http")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("AI provider endpoint is invalid".into());
        }
        let secure = parsed.scheme() == "https";
        let host = parsed.host_str().unwrap();
        let port = parsed
            .port_or_known_default()
            .ok_or("AI provider endpoint has no port")?;
        let mut path = parsed.path().to_string();
        if let Some(query) = parsed.query() {
            path.push('?');
            path.push_str(query);
        }
        if !matches!(method, "GET" | "POST") {
            return Err("Unsupported native HTTP method".into());
        }
        let mut header_text = format!("Content-Type: {content_type}\r\n");
        for (name, value) in headers {
            if name.is_empty() || name.contains(['\r', '\n', ':']) || value.contains(['\r', '\n']) {
                return Err("AI provider supplied an invalid HTTP header".into());
            }
            header_text.push_str(&name);
            header_text.push_str(": ");
            header_text.push_str(&value);
            header_text.push_str("\r\n");
        }
        header_text.push_str("\r\n");
        let agent = wide("Planager/0.1");
        let host_w = wide(host);
        let verb = wide(method);
        let path_w = wide(&path);
        let session = H(unsafe { WinHttpOpen(agent.as_ptr(), 1, ptr::null(), ptr::null(), 0) });
        if session.0.is_null() {
            return Err(format!(
                "Windows HTTP session failed ({})",
                std::io::Error::last_os_error()
            ));
        }
        check(
            unsafe { WinHttpSetTimeouts(session.0, 10000, 15000, 15000, 45000) },
            "timeout setup",
        )?;
        let connect = H(unsafe { WinHttpConnect(session.0, host_w.as_ptr(), port, 0) });
        if connect.0.is_null() {
            return Err(format!(
                "Windows HTTP connection failed ({})",
                std::io::Error::last_os_error()
            ));
        }
        let flags = if secure { 0x00800000 } else { 0 };
        let request = H(unsafe {
            WinHttpOpenRequest(
                connect.0,
                verb.as_ptr(),
                path_w.as_ptr(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                flags,
            )
        });
        if request.0.is_null() {
            return Err(format!(
                "Windows HTTP request setup failed ({})",
                std::io::Error::last_os_error()
            ));
        }
        let redirect_policy_never: u32 = 0;
        check(
            unsafe {
                WinHttpSetOption(
                    request.0,
                    88,
                    &redirect_policy_never as *const u32 as *mut c_void,
                    std::mem::size_of::<u32>() as u32,
                )
            },
            "redirect policy setup",
        )?;
        let headers_w = wide(&header_text);
        check(
            unsafe {
                WinHttpSendRequest(
                    request.0,
                    headers_w.as_ptr(),
                    u32::MAX,
                    body.as_ptr() as *mut c_void,
                    body.len() as u32,
                    body.len() as u32,
                    0,
                )
            },
            "send",
        )?;
        check(
            unsafe { WinHttpReceiveResponse(request.0, ptr::null_mut()) },
            "response",
        )?;
        let mut status: u32 = 0;
        let mut status_size = std::mem::size_of::<u32>() as u32;
        check(
            unsafe {
                WinHttpQueryHeaders(
                    request.0,
                    19 | 0x20000000,
                    ptr::null(),
                    &mut status as *mut _ as *mut c_void,
                    &mut status_size,
                    ptr::null_mut(),
                )
            },
            "status read",
        )?;
        let mut output = Vec::new();
        loop {
            let mut available = 0;
            check(
                unsafe { WinHttpQueryDataAvailable(request.0, &mut available) },
                "body read",
            )?;
            if available == 0 {
                break;
            }
            if output.len().saturating_add(available as usize) > 8 * 1024 * 1024 {
                return Err("AI provider response exceeded 8 MB".into());
            }
            let start = output.len();
            output.resize(start + available as usize, 0);
            let mut read = 0;
            check(
                unsafe {
                    WinHttpReadData(
                        request.0,
                        output[start..].as_mut_ptr() as *mut c_void,
                        available,
                        &mut read,
                    )
                },
                "body read",
            )?;
            output.truncate(start + read as usize);
        }
        Ok((status as u16, output))
    }

    pub fn post_json(
        url: &str,
        headers: Vec<(String, String)>,
        body: &[u8],
    ) -> Result<(u16, Vec<u8>), String> {
        request("POST", url, "application/json", headers, body)
    }

    pub fn post_form(
        url: &str,
        headers: Vec<(String, String)>,
        body: &[u8],
    ) -> Result<(u16, Vec<u8>), String> {
        request(
            "POST",
            url,
            "application/x-www-form-urlencoded",
            headers,
            body,
        )
    }

    pub fn get(url: &str) -> Result<(u16, Vec<u8>), String> {
        request("GET", url, "application/json", Vec::new(), &[])
    }

    pub fn get_with_headers(
        url: &str,
        headers: Vec<(String, String)>,
    ) -> Result<(u16, Vec<u8>), String> {
        request("GET", url, "application/json", headers, &[])
    }
}

#[cfg(target_os = "windows")]
pub use platform::{get, get_with_headers, post_form, post_json};

#[cfg(not(target_os = "windows"))]
pub fn request(
    _: &str,
    _: &str,
    _: &str,
    _: Vec<(String, String)>,
    _: &[u8],
) -> Result<(u16, Vec<u8>), String> {
    Err("Native AI networking is implemented for Windows only".into())
}

#[cfg(not(target_os = "windows"))]
pub fn post_json(
    url: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<(u16, Vec<u8>), String> {
    request("POST", url, "application/json", headers, body)
}

#[cfg(not(target_os = "windows"))]
pub fn post_form(
    url: &str,
    headers: Vec<(String, String)>,
    body: &[u8],
) -> Result<(u16, Vec<u8>), String> {
    request(
        "POST",
        url,
        "application/x-www-form-urlencoded",
        headers,
        body,
    )
}

#[cfg(not(target_os = "windows"))]
pub fn get(url: &str) -> Result<(u16, Vec<u8>), String> {
    request("GET", url, "application/json", Vec::new(), &[])
}

#[cfg(not(target_os = "windows"))]
pub fn get_with_headers(
    url: &str,
    headers: Vec<(String, String)>,
) -> Result<(u16, Vec<u8>), String> {
    request("GET", url, "application/json", headers, &[])
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::post_json;
    use std::{
        io::{Read, Write},
        net::{Shutdown, TcpListener},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn redirects_are_returned_without_forwarding_provider_credentials() {
        let capture = TcpListener::bind("127.0.0.1:0").unwrap();
        capture.set_nonblocking(true).unwrap();
        let capture_address = capture.local_addr().unwrap();
        let redirected = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                match capture.accept() {
                    Ok((mut stream, _)) => {
                        stream
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut bytes = Vec::new();
                        let mut chunk = [0u8; 2048];
                        let n = stream.read(&mut chunk).unwrap_or(0);
                        bytes.extend_from_slice(&chunk[..n]);
                        return Some(bytes);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return None;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("redirect capture failed: {error}"),
                }
            }
        });

        let redirect = TcpListener::bind("127.0.0.1:0").unwrap();
        let redirect_address = redirect.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = redirect.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 2048];
            let header_end = loop {
                let n = stream.read(&mut chunk).unwrap();
                assert_ne!(n, 0, "request closed before its headers arrived");
                request.extend_from_slice(&chunk[..n]);
                if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    break end;
                }
            };
            let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
            let content_length = headers
                .lines()
                .skip(1)
                .filter_map(|line| line.split_once(':'))
                .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .expect("POST request should include a valid Content-Length");
            let request_length = header_end + 4 + content_length;
            while request.len() < request_length {
                let n = stream.read(&mut chunk).unwrap();
                assert_ne!(n, 0, "request closed before its complete body arrived");
                request.extend_from_slice(&chunk[..n]);
            }
            assert_eq!(
                request.len(),
                request_length,
                "unexpected bytes beyond POST body"
            );
            assert!(headers
                .to_ascii_lowercase()
                .contains("authorization: bearer redirect-secret"));
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{capture_address}/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
            stream.shutdown(Shutdown::Write).unwrap();
        });

        let (status, _) = post_json(
            &format!("http://{redirect_address}/provider"),
            vec![("Authorization".into(), "Bearer redirect-secret".into())],
            b"{}",
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(status, 302, "redirect status must be returned to caller");
        assert!(
            redirected.join().unwrap().is_none(),
            "redirect target must never receive the credential header"
        );
    }
}
