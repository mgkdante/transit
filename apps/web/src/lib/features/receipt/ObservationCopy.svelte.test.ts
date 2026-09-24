import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ObservationCopy from './ObservationCopy.svelte';

const text = 'Transit — STM\n2026-06-17\nAverage delay: 3.4 min';
afterEach(() => vi.unstubAllGlobals());

describe('Copy this observation', () => {
	it.each([
		['en', 'Copy this observation', 'Observation copied.'],
		['fr', 'Copier cette observation', 'Observation copiée.'],
	] as const)(
		'copies only on user action and announces success in %s',
		async (locale, label, success) => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal('navigator', { clipboard: { writeText } });
			render(ObservationCopy, { text, locale });
			expect(writeText).not.toHaveBeenCalled();
			await fireEvent.click(screen.getByRole('button', { name: label }));
			await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(success));
			expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
		},
	);

	it.each([undefined, { writeText: () => Promise.reject(new Error('denied')) }])(
		'provides focused selectable text when the clipboard is unavailable or rejects',
		async (clipboard) => {
			vi.stubGlobal('navigator', { clipboard });
			render(ObservationCopy, { text, locale: 'en' });
			await fireEvent.click(screen.getByRole('button', { name: 'Copy this observation' }));
			const fallback = await screen.findByRole('textbox', { name: 'Observation text' });
			expect(fallback).toHaveValue(text);
			expect(fallback).toHaveAttribute('readonly');
			await waitFor(() => expect(fallback).toHaveFocus());
			expect((fallback as HTMLTextAreaElement).selectionStart).toBe(0);
			expect((fallback as HTMLTextAreaElement).selectionEnd).toBe(text.length);
		},
	);
});
