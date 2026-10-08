# Legal Twin visualization components

This folder provides controlled React components for rendering graph data supplied by the caller. It contains no case data, network calls, or persistence.

- `TwinCanvas` projects node positions into an interactive 3D-style SVG view. Pass `position` on nodes to control the layout, or omit it to use a deterministic category-seeded, edge-aware layout. Snapshot changes animate nodes and links; selecting a node shifts the viewport focus. The view uses the supplied edges as its only relationships and remains keyboard-operable without WebGL.
- `TwinTimeline` selects among dated snapshots. `TwinCanvas` displays a snapshot's graph when `currentTime` exactly matches its `at` value; otherwise, it applies each node and edge's optional validity interval to the base graph.
- `TwinInspector` resolves selected node and edge IDs against the supplied graph data.
- `TwinLegend` and `TwinSnapshot` can be composed independently.
- `TwinGuideCompanion` reuses the application's animated guide portrait in a caller-controlled, presentational map aside. Its idle state does not receive case or legal analysis data.

The visual evidence statuses distinguish supported, user-reported, uncertain, conflicting, and unknown records. The case route maps the API's evidence statuses into these display categories; the visualization does not create or revise case facts. Reduced-motion preferences disable the stage's animated transitions and confirmation pulses.

Validity intervals use a start-inclusive, end-exclusive convention: `[validFrom, validTo)`. `currentTime` and snapshot timestamps accept ISO date strings or epoch milliseconds. A missing `currentTime` leaves the base graph unfiltered.

Import the component and type exports from this folder's `index.ts`. `TwinCanvas` and `TwinTimeline` are client components because they contain interactive controls; their callbacks should be wired within a client component boundary.
