<script lang="ts">
	import { createRawSnippet, type Snippet } from 'svelte';
	import MapDetailOverlay from '../MapDetailOverlay.svelte';

	interface Props {
		widthPx?: number;
		collapsed?: boolean;
		dragging?: boolean;
		resizeAria?: string;
		detailPanel?: Snippet;
		onstate?: (state: { widthPx: number; collapsed: boolean; dragging: boolean }) => void;
	}

	let {
		widthPx = $bindable(400),
		collapsed = $bindable(false),
		dragging = $bindable(false),
		resizeAria = 'Resize detail panel',
		detailPanel = createRawSnippet(() => ({
			render: () => `<div data-testid="detail-panel-body">detail</div>`,
		})),
		onstate,
	}: Props = $props();

	$effect(() => {
		onstate?.({ widthPx, collapsed, dragging });
	});
</script>

<MapDetailOverlay bind:widthPx bind:collapsed bind:dragging {resizeAria} {detailPanel} />
