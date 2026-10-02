<script lang="ts">
	import { Dialog } from 'bits-ui';
	let {
		onOuterOutside = (_event: PointerEvent) => {},
		onInnerOutside = (_event: PointerEvent) => {},
		interceptStart = false,
	}: {
		onOuterOutside?: (event: PointerEvent) => void;
		onInnerOutside?: (event: PointerEvent) => void;
		interceptStart?: boolean;
	} = $props();
	let outerOpen = $state(true),
		innerOpen = $state(false);
</script>

<button
	data-testid="outside"
	onpointerdown={(event) => {
		if (interceptStart) event.stopPropagation();
	}}>Outside</button
>
<button
	data-testid="disable"
	onclick={() => {
		outerOpen = false;
	}}>Disable</button
>
<Dialog.Root bind:open={outerOpen}>
	<Dialog.Portal>
		<Dialog.Content
			data-testid="outer"
			aria-describedby={undefined}
			onInteractOutside={onOuterOutside}
		>
			<Dialog.Title>Outer</Dialog.Title>
			<button data-testid="inside">Inside</button>
			<Dialog.Root bind:open={innerOpen}>
				<Dialog.Trigger data-testid="open-inner">Nested</Dialog.Trigger>
				<Dialog.Portal>
					<Dialog.Content
						data-testid="inner"
						aria-describedby={undefined}
						onInteractOutside={onInnerOutside}
					>
						<Dialog.Title>Inner</Dialog.Title>
						<button data-testid="inner-button">Nested action</button>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
