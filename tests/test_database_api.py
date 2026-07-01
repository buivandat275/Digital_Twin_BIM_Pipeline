from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

try:
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker
    from sqlalchemy.pool import StaticPool

    from api.database import Base, get_db
    from api.main import app

    DEPENDENCIES_AVAILABLE = True
except ImportError:
    DEPENDENCIES_AVAILABLE = False


@unittest.skipUnless(DEPENDENCIES_AVAILABLE, "Install requirements.txt to run database API tests")
class DatabaseApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite+pysqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        cls.sessions = sessionmaker(bind=cls.engine, expire_on_commit=False)

        def override_db():
            with cls.sessions() as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        cls.client = TestClient(app)
        cls.headers = {"X-Actor-Name": "Ki%E1%BB%83m%20th%E1%BB%AD", "X-Request-ID": "test-request"}

    @classmethod
    def tearDownClass(cls) -> None:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(cls.engine)

    def _create_asset(self) -> tuple[str, str]:
        project = self.client.post(
            "/api/v1/projects",
            headers=self.headers,
            json={"code": "TEST", "name": "Test Project"},
        ).json()
        model = self.client.post(
            f"/api/v1/projects/{project['id']}/models",
            headers=self.headers,
            json={"source_file": "test.ifc", "source_checksum": "abc"},
        ).json()
        response = self.client.post(
            f"/api/v1/models/{model['id']}/objects:batch-upsert",
            headers=self.headers,
            json={
                "objects": [
                    {
                        "ifc_guid": "GUID-1",
                        "name": "FCU 1",
                        "ifc_class": "IfcUnitaryEquipment",
                        "operational_scope": "maintainable",
                        "om_values": {
                            "EMSD.Common.Asset Code": "A-001",
                            "VSF.Common.Asset Code": "A-001",
                        },
                    }
                ]
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        asset = self.client.get(f"/api/v1/models/{model['id']}/assets/by-ifc-guid/GUID-1").json()
        return model["id"], asset["id"]

    def test_draft_does_not_apply_until_approved_and_audit_is_written(self) -> None:
        model_id, asset_id = self._create_asset()
        before = self.client.get(f"/api/v1/models/{model_id}/assets/by-ifc-guid/GUID-1").json()
        draft = self.client.post(
            f"/api/v1/assets/{asset_id}/changes",
            headers=self.headers,
            json={
                "base_version": before["rowVersion"],
                "patch": {"values": {"VSF.Status": "Active"}},
                "source": "test",
            },
        )
        self.assertEqual(draft.status_code, 200, draft.text)
        unchanged = self.client.get(f"/api/v1/models/{model_id}/assets/by-ifc-guid/GUID-1").json()
        self.assertEqual(unchanged["normalizedProperties"]["VSF.Status"], "")

        approved = self.client.post(
            f"/api/v1/change-requests/{draft.json()['id']}/approve",
            headers=self.headers,
            json={"source": "test"},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["asset"]["normalizedProperties"]["VSF.Status"], "Active")
        audit = self.client.get(f"/api/v1/assets/{asset_id}/audit").json()["items"]
        self.assertTrue(any(event["action"] == "asset.change_approved" for event in audit))

    def test_stale_version_returns_409(self) -> None:
        model_id, asset_id = self._create_asset()
        response = self.client.post(
            f"/api/v1/assets/{asset_id}/changes",
            headers=self.headers,
            json={"base_version": 999, "patch": {"values": {"VSF.Status": "Active"}}},
        )
        self.assertEqual(response.status_code, 409)

    def test_missing_actor_is_rejected(self) -> None:
        response = self.client.post("/api/v1/projects", json={"code": "NOACTOR", "name": "No Actor"})
        self.assertEqual(response.status_code, 400)

    def test_duplicate_source_asset_codes_are_quarantined_before_sync(self) -> None:
        from services.database_api import _duplicate_asset_codes, _object_payload

        objects = [
            {"global_id": "DUP-1", "EMSD.Common.Asset Code": "A-001", "VSF.Common.Asset Code": "A-001"},
            {"global_id": "DUP-2", "EMSD.Common.Asset Code": "A-001", "VSF.Common.Asset Code": "A-001"},
        ]
        duplicates = _duplicate_asset_codes(objects)
        payload = _object_payload(objects[0], duplicates)
        self.assertEqual(payload["om_values"]["EMSD.Common.Asset Code"], "")
        self.assertEqual(payload["om_values"]["VSF.Common.Asset Code"], "")
        self.assertEqual(
            payload["raw_source"]["blocked_duplicate_asset_codes"]["VSF.Common.Asset Code"],
            "A-001",
        )

    def test_api_request_allows_custom_timeout(self) -> None:
        from services.database_api import _request

        response = Mock(ok=True)
        response.json.return_value = {"ok": True}
        with patch("services.database_api.requests.request", return_value=response) as request:
            self.assertEqual(_request("GET", "/api/v1/health", timeout=120), {"ok": True})
        self.assertEqual(request.call_args.kwargs["timeout"], 120)


if __name__ == "__main__":
    unittest.main()
