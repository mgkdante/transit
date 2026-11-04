<script lang="ts">
	import * as Sheet from '@yesid/ui/sheet';
	let { onOutside }: { onOutside: (event: PointerEvent) => void } = $props();
	let open = $state(true);
</script>

<button data-testid="outside">Outside</button>
<Sheet.Root bind:open>
	<Sheet.Content onInteractOutside={onOutside} aria-describedby={undefined} showCloseButton={false}>
		<Sheet.Title>Production sheet</Sheet.Title>
		<button>Inside</button>
	</Sheet.Content>
</Sheet.Root>
