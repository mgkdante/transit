<script lang="ts">
	import { setV1Context, type V1Context } from '$lib/v1/boot';

	let { context }: { context?: V1Context } = $props();
	setV1Context(() => context);
</script>

<div data-testid="optional-v1-context">{context?.manifest.provider ?? 'pending'}</div>
