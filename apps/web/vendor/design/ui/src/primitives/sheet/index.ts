import { Dialog as SheetPrimitive } from 'bits-ui';

import Title, { type SheetTitleProps } from './sheet-title.svelte';
import Footer, { type SheetFooterProps } from './sheet-footer.svelte';
import Header, { type SheetHeaderProps } from './sheet-header.svelte';
import Overlay, { type SheetOverlayProps } from './sheet-overlay.svelte';
import Content, {
	sheetVariants,
	type SheetContentProps,
	type SheetSide,
} from './sheet-content.svelte';
import Description, { type SheetDescriptionProps } from './sheet-description.svelte';

const Root = SheetPrimitive.Root;
const Trigger = SheetPrimitive.Trigger;
const Close = SheetPrimitive.Close;
const Portal = SheetPrimitive.Portal;

export type SheetRootProps = SheetPrimitive.RootProps;
export type SheetTriggerProps = SheetPrimitive.TriggerProps;
export type SheetCloseProps = SheetPrimitive.CloseProps;
export type SheetPortalProps = SheetPrimitive.PortalProps;

export type {
	SheetContentProps,
	SheetDescriptionProps,
	SheetFooterProps,
	SheetHeaderProps,
	SheetOverlayProps,
	SheetTitleProps,
};

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
