import ssl

import certifi


def test_runtime_trust_bundle_rejects_compromised_emsign_root() -> None:
    context = ssl.create_default_context(cafile=certifi.where())
    root_names = {
        value
        for certificate in context.get_ca_certs()
        for relative_name in certificate["subject"]
        for attribute, value in relative_name
        if attribute == "commonName"
    }

    assert "emSign ECC Root CA - G3" not in root_names
    assert "ISRG Root X1" in root_names
    assert context.check_hostname
    assert context.verify_mode == ssl.CERT_REQUIRED
