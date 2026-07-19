import Root, { type ToggleGroupProps } from './toggle-group.svelte';
import Item, { type ToggleGroupItemProps } from './toggle-group-item.svelte';

export type { ToggleGroupItemProps, ToggleGroupProps };

export {
	Root,
	Item,
	//
	Root as ToggleGroup,
	Item as ToggleGroupItem,
};
