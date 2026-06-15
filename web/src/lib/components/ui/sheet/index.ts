import { Dialog as SheetPrimitive } from 'bits-ui';

import Title from './sheet-title.svelte';
import Footer from './sheet-footer.svelte';
import Header from './sheet-header.svelte';
import Overlay from './sheet-overlay.svelte';
import Content, { sheetVariants, type SheetSide } from './sheet-content.svelte';
import Description from './sheet-description.svelte';

const Root = SheetPrimitive.Root;
const Trigger = SheetPrimitive.Trigger;
const Close = SheetPrimitive.Close;
const Portal = SheetPrimitive.Portal;

export {
	Root,
	Title,
	Portal,
	Footer,
	Header,
	Trigger,
	Overlay,
	Content,
	Description,
	Close,
	sheetVariants,
	type SheetSide,
	//
	Root as Sheet,
	Title as SheetTitle,
	Portal as SheetPortal,
	Footer as SheetFooter,
	Header as SheetHeader,
	Trigger as SheetTrigger,
	Overlay as SheetOverlay,
	Content as SheetContent,
	Description as SheetDescription,
	Close as SheetClose,
};
