# Campus Site View

## Goal

Phase 1 renders multiple IFC buildings in one campus scene without merging IFC files.

The campus scene is a lightweight 3D site map:

```text
site-layout.json
-> land parcels + roads + building placements
-> React CampusView loads GLB previews for each building
-> click / double click building
-> load the real IFC detail view for that building
```

## Current Demo Files

The current site uses four IFC files from `output/`:

- `Nha1.ifc`
- `Nha2.ifc`
- `20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc`
- `20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment_level09_level10_fixed.ifc`

The site layout is configured in:

```text
mock-db/site-layout.json
```

Each building keeps:

```text
ifc_file     -> used by Building Detail view
preview_glb  -> used by Campus Site View
```

The mock API endpoint is:

```text
GET /api/operations/site-layout
```

GLB preview files are generated into:

```text
digital-twin-viewer/public/model-previews/
```

Generate or refresh previews with:

```bash
node scripts/generate_ifc_glb_previews.mjs
```

## Design Choice

We do not create one combined IFC file.

Reason:

- A city/campus scale model should not force all buildings into one heavy IFC.
- Each building can keep its original IFC lifecycle and versioning.
- The overview can stay light, while detail mode loads the IFC that the user selected.

## Current Behavior

In React:

- Default mode opens `Campus`.
- Campus view displays land, roads, and four lightweight GLB building previews.
- Click a building preview to select it.
- Double click a building preview or press `Open Detail` to load its real IFC.
- If a GLB preview is missing or cannot be loaded, CampusView falls back to a translucent box placeholder.
- Detail mode reuses the existing operations workflow: 3D IFC viewer, asset list, filters, natural language search, alerts, telemetry, 2D plan, spatial search, route, and dispatch.
- `Back to Campus` returns to the site overview.

## Asset Mapping

Existing operations assets are still mock registry assets and are mapped to:

```text
building_id = MARRIOTT_EQUIPMENT
```

`MARRIOTT_FIXED` currently reuses the same asset source with:

```text
asset_source_building_id = MARRIOTT_EQUIPMENT
```

`Nha1.ifc` and `Nha2.ifc` currently behave as building geometry only unless assets are added for their building IDs.

## Next Reasonable Steps

- Add simple thumbnail/status cards for each building.
- Add building-level search: find building by name, file, alert count, asset count.
- Add per-building asset registry for `NHA_1` and `NHA_2`.
- Add a more aggressive LOD step if GLB previews become too large for city scale.
- Add GIS/map coordinates if this grows beyond a demo campus.
