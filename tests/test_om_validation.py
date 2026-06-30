from __future__ import annotations

import unittest

import pandas as pd

from rules.om_field_rules import OM_FIELD_NAMES, extract_om_fields
from services.bms_device_importer import (
    apply_bms_mappings,
    merge_bms_devices,
    reconcile_bms_devices,
)
from services.correction_template import build_correction_template, merge_correction_template
from services.mapper import build_asset_master, build_preview_tables
from services.validated_twin_snapshot import build_validated_twin_snapshot
from services.validator import validate_assets


class OmValidationTests(unittest.TestCase):
    def test_exact_ifc_properties_and_location_are_mapped(self) -> None:
        values, sources = extract_om_fields(
            {
                "EMSD_Common": {
                    "EMSD.Common.Asset Code": "EMSD-001",
                    "EMSD.Common.Asset Tag No.": "TAG-001",
                    "EMSD.Common.Manufacturer": "Vendor",
                },
                "VSF_Common": {
                    "VSF.Common.Asset Code": "VSF-001",
                    "VSF.Common.Asset Tag No.": "VTAG-001",
                    "VSF.Common.Manufacturer": "Vendor",
                },
            },
            "TẦNG 19",
        )

        self.assertEqual(values["VSF.Location"], "TẦNG 19")
        self.assertEqual(sources["VSF.Location"], "ifc_spatial")
        self.assertEqual(sum(bool(values[field]) for field in OM_FIELD_NAMES), 7)

    def test_validation_only_checks_the_ten_fields(self) -> None:
        obj = {"global_id": "GUID-1", "name": "FCU", "operational_scope": "maintainable"}
        obj.update({field: f"value-{index}" for index, field in enumerate(OM_FIELD_NAMES)})
        obj["VSF.Link"] = ""
        obj["VSF.Status"] = ""
        obj["VSF.Document"] = ""

        validation, summary = validate_assets([obj])

        self.assertEqual(len(validation), 3)
        self.assertEqual(set(validation["field"]), {"VSF.Link", "VSF.Status", "VSF.Document"})
        self.assertEqual(summary["complete_objects"], 0)
        self.assertEqual(summary["incomplete_objects"], 1)

    def test_manual_correction_updates_missing_field_and_source(self) -> None:
        obj = {
            "global_id": "GUID-2",
            "name": "FCU",
            "operational_scope": "maintainable",
            "VSF.Location": "TẦNG 19",
        }
        template = build_correction_template([obj])
        template.loc[0, "VSF.Link"] = "https://example.test/fcu"
        merged, log = merge_correction_template([obj], template)

        self.assertEqual(merged[0]["VSF.Link"], "https://example.test/fcu")
        self.assertEqual(merged[0]["om_field_sources"]["VSF.Link"], "manual_correction")
        self.assertEqual(len(log), 1)

    def test_snapshot_contains_exactly_ten_normalized_fields(self) -> None:
        obj = {
            "global_id": "GUID-3",
            "name": "FCU",
            "asset_name": "FCU",
            "ifc_class": "IfcBuildingElementProxy",
            "operational_scope": "maintainable",
            "operational_scope_reason": "test asset",
        }
        obj.update({field: "ok" for field in OM_FIELD_NAMES})
        validation, summary = validate_assets([obj])
        snapshot = build_validated_twin_snapshot(
            build_preview_tables(build_asset_master([obj])),
            validation,
            project_id="DEMO",
            project_name="Demo",
            source_file="demo.ifc",
            validation_profile="vsf_om_10",
            validation_summary=summary,
            compliance_summary={"status": "Pass"},
        )

        asset = snapshot["assets"][0]
        self.assertEqual(list(asset["normalizedProperties"]), OM_FIELD_NAMES)
        self.assertEqual(asset["readinessStatus"], "Complete")
        self.assertEqual(asset["bmsDevice"], {})
        self.assertEqual(snapshot["summary"]["complete"], 1)

    def test_snapshot_only_exposes_bms_section_with_real_bms_device_id(self) -> None:
        obj = {
            "global_id": "GUID-BMS-SNAPSHOT",
            "name": "FCU",
            "asset_name": "FCU BMS",
            "ifc_class": "IfcBuildingElementProxy",
            "operational_scope": "realtime",
            "bms_device_id": "BMS-FCU-001",
            "bms_device_name": "FCU BMS",
            "bms_import_source": "BMS Device Register",
            "status": "Active",
            "floor": "TẦNG 19",
            "location": "TẦNG 19 / Phòng kỹ thuật",
        }
        obj.update({field: "ok" for field in OM_FIELD_NAMES})
        validation, summary = validate_assets([obj])
        snapshot = build_validated_twin_snapshot(
            build_preview_tables(build_asset_master([obj])),
            validation,
            project_id="DEMO",
            project_name="Demo",
            source_file="demo.ifc",
            validation_profile="vsf_om_10",
            validation_summary=summary,
            compliance_summary={"status": "Pass"},
        )

        self.assertEqual(snapshot["assets"][0]["bmsDevice"]["device_id"], "BMS-FCU-001")
        self.assertEqual(snapshot["assets"][0]["bmsDevice"]["source"], "BMS Device Register")

    def test_context_object_is_excluded_from_ten_field_validation(self) -> None:
        context = {
            "global_id": "GUID-CONTEXT",
            "name": "Wall",
            "ifc_class": "IfcWall",
            "operational_scope": "context",
        }
        validation, summary = validate_assets([context])

        self.assertTrue(validation.empty)
        self.assertEqual(summary["context_objects"], 1)
        self.assertEqual(summary["checked_objects"], 0)

    def test_scope_review_can_be_confirmed_in_correction_template(self) -> None:
        obj = {
            "global_id": "GUID-SCOPE",
            "name": "FCU",
            "ifc_class": "IfcBuildingElementProxy",
            "operational_scope": "scope_review",
        }
        template = build_correction_template([obj])
        template.loc[0, "operational_scope"] = "realtime"
        merged, _ = merge_correction_template([obj], template)

        self.assertEqual(merged[0]["operational_scope"], "realtime")
        self.assertEqual(merged[0]["operational_scope_source"], "manual_correction")

    def test_bms_device_register_maps_by_asset_code(self) -> None:
        obj = {
            "global_id": "GUID-BMS",
            "name": "FCU",
            "operational_scope": "scope_review",
            "EMSD.Common.Asset Code": "TNP-VSF-BD-K1-HVAC-M3_A-043",
            "VSF.Common.Asset Code": "TNP-VSF-BD-K1-HVAC-M3_A-043",
        }
        bms = pd.DataFrame(
            [
                {
                    "AssetCode": "TNP-VSF-BD-K1-HVAC-M3_A-043",
                    "BMSDeviceID": "BMS-FCU-043",
                    "DeviceName": "FCU Tầng 19 - 043",
                    "Status": "Active",
                    "Floor": "TẦNG 19",
                    "Room": "Phòng kỹ thuật 19",
                    "Location": "",
                    "Link": "bms://devices/BMS-FCU-043",
                    "Document": "https://example.test/FCU-043.pdf",
                    "Manufacturer": "INNO",
                }
            ]
        )

        merged, log, summary = merge_bms_devices([obj], bms)
        asset = merged[0]

        self.assertEqual(summary["matched_objects"], 1)
        self.assertEqual(len(log), 1)
        self.assertEqual(asset["bms_device_id"], "BMS-FCU-043")
        self.assertEqual(asset["asset_name"], "FCU Tầng 19 - 043")
        self.assertEqual(asset["VSF.Status"], "Active")
        self.assertEqual(asset["VSF.Location"], "TẦNG 19 / Phòng kỹ thuật 19")
        self.assertEqual(asset["operational_scope"], "realtime")
        self.assertEqual(asset["om_field_sources"]["VSF.Status"], "bms_device_register")

    def test_duplicate_ifc_asset_code_is_blocked_until_confirmation(self) -> None:
        objects = [
            {
                "global_id": "GUID-DUP-1",
                "name": "FCU 1",
                "VSF.Common.Asset Code": "DUP-001",
            },
            {
                "global_id": "GUID-DUP-2",
                "name": "FCU 2",
                "VSF.Common.Asset Code": "DUP-001",
            },
        ]
        bms = pd.DataFrame(
            [{"AssetCode": "DUP-001", "BMSDeviceID": "BMS-DUP", "Status": "Active"}]
        )

        reconciliation = reconcile_bms_devices(objects, bms)
        auto_merged, _, summary = merge_bms_devices(objects, bms)

        self.assertEqual(reconciliation["summary"]["auto_ready"], 0)
        self.assertEqual(reconciliation["summary"]["duplicate_ifc"], 1)
        self.assertEqual(len(reconciliation["problems"][0]["candidates"]), 2)
        self.assertEqual(summary["matched_rows"], 0)
        self.assertNotIn("bms_device_id", auto_merged[0])
        self.assertNotIn("bms_device_id", auto_merged[1])

        confirmed, log, applied = apply_bms_mappings(
            objects,
            reconciliation["bms_df"],
            [
                {
                    "bms_row_index": 0,
                    "target_global_id": "GUID-DUP-2",
                    "decision": "manual_confirmation",
                }
            ],
            mapping_source="manual_confirmation",
        )
        self.assertEqual(applied["applied"], 1)
        self.assertEqual(log.iloc[0]["result"], "Đã map")
        self.assertNotIn("bms_device_id", confirmed[0])
        self.assertEqual(confirmed[1]["bms_device_id"], "BMS-DUP")

    def test_duplicate_bms_rows_and_unmatched_code_require_review(self) -> None:
        objects = [{"global_id": "GUID-1", "VSF.Common.Asset Code": "A-001"}]
        bms = pd.DataFrame(
            [
                {"AssetCode": "A-001", "BMSDeviceID": "BMS-1"},
                {"AssetCode": "A-001", "BMSDeviceID": "BMS-2"},
                {"AssetCode": "NOT-FOUND", "BMSDeviceID": "BMS-3"},
            ]
        )
        reconciliation = reconcile_bms_devices(objects, bms)

        self.assertEqual(reconciliation["summary"]["auto_ready"], 0)
        self.assertEqual(reconciliation["summary"]["duplicate_bms"], 2)
        self.assertEqual(reconciliation["summary"]["unmatched"], 1)


if __name__ == "__main__":
    unittest.main()
