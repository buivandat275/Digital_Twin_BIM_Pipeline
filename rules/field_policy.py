from __future__ import annotations

from rules.om_field_rules import OM_FIELD_NAMES


FIELD_POLICY_PROFILES = {
    "vsf_om_10": {
        "label": "10 trường EMSD/VSF",
        "description": (
            "Chỉ kiểm tra đúng 10 trường EMSD/VSF trên object vận hành/cần xác nhận. VSF.Location được map tự động "
            "từ vị trí/tầng IFC khi property chưa có."
        ),
        "required": OM_FIELD_NAMES,
        "optional": [],
        "ignored": [],
    }
}


def get_profile_names() -> list[str]:
    return list(FIELD_POLICY_PROFILES.keys())


def get_profile(profile_name: str) -> dict:
    return FIELD_POLICY_PROFILES.get(profile_name, FIELD_POLICY_PROFILES["vsf_om_10"])


def get_policy_rows(profile_name: str) -> list[dict]:
    return [
        {
            "field": field,
            "policy": "required",
            "applies_to": "asset vận hành và object cần xác nhận phạm vi",
        }
        for field in get_profile(profile_name)["required"]
    ]


def get_validated_fields(profile_name: str) -> list[str]:
    return list(get_profile(profile_name)["required"])


def get_required_fields(profile_name: str, operational_scope: str = "") -> list[str]:
    return get_validated_fields(profile_name)


def get_template_fields(profile_name: str) -> list[str]:
    return get_validated_fields(profile_name)
