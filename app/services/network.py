import os


def validate_proxy(proxy: str) -> str:
    proxy = proxy.strip()
    if proxy and not proxy.startswith("socks5://"):
        raise ValueError("Only socks5:// proxy URLs are supported")
    return proxy


def apply_proxy_environment(proxy: str) -> None:
    proxy = validate_proxy(proxy)
    keys = ("ALL_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "http_proxy", "https_proxy")
    if proxy:
        for key in keys:
            os.environ[key] = proxy
    else:
        for key in keys:
            os.environ.pop(key, None)
