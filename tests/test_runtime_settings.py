import pytest

from app.services.network import validate_proxy


def test_socks_proxy_validation():
    assert validate_proxy("socks5://127.0.0.1:9004") == "socks5://127.0.0.1:9004"
    assert validate_proxy("") == ""
    with pytest.raises(ValueError):
        validate_proxy("http://127.0.0.1:8080")
