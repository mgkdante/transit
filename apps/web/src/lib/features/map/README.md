# Map interface

`MapHero` owns selection, URLs, camera coordination and live-store lifecycle. `mapRuntime` owns custom layers, motion, pointer interaction, source feeds, emphasis and cleanup for the mounted map; style reloads restore sources before replaying emphasis. The local overlay and detail components arrange values and pass user actions back to MapHero.

`MapFilters` owns its disclosure state and delegates filter values to `FilterStore`. `MapFilterRail` sizes the collapsed rail from its buttons. `MapMotionControl` keeps the existing `raw` and `smooth` store values: reported positions by default, estimated positions as an explicit choice.

`DetailAttributeGrid` owns definition-row layout for both desktop and mobile details. Only a row with a direct action gets an action column; nested messages keep their own layout. `MapHeadTitle` and `MapFeedStallBanner` keep mobile freshness and notices clear of the heading without changing announcement priority.

`MapFreshness` labels report age independently of current feed availability. A failed vehicle feed keeps the report timestamp and caution state; `MapFeedStallBanner` names the unavailable positions. Aggregate stalls retain their “not responding” readout and last-update timestamp.

`vehicleSprites` owns marker geometry and `vehicleLayer` applies its scaled offsets. The bus stays at the reported coordinate; the heading clears its silhouette, and status/stale badges share a row below it. Geometry changes need bearing, zoom, badge-pair and picking checks.

Run the map tests from `apps/web` with `bun run test src/lib/features/map`. Browser review also needs both desktop panels independently and together, touch controls, selection, empty positions, feed failure, renderer retry and reduced motion. Panel changes must leave the map canvas dimensions unchanged.
