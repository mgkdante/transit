const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);
export const refreshCopy = {
	en: {
		updated: (time: string) => sentence(`Live data updated at ${time}`),
		recordUnchanged: (time: string, date: string) =>
			`${sentence(`Live data updated at ${time}`)} ${sentence(`The record has not changed since ${date}`)}`,
		recordNew: (date: string) =>
			sentence(`Updated. A new record is published: data through ${date}`),
		failed: (time: string) => sentence(`Could not refresh. Showing data from ${time}`),
	},
	fr: {
		updated: (time: string) => sentence(`Données en direct mises à jour à ${time}`),
		recordUnchanged: (time: string, date: string) =>
			`${sentence(`Données en direct mises à jour à ${time}`)} ${sentence(`Le bilan n’a pas changé depuis le ${date}`)}`,
		recordNew: (date: string) =>
			sentence(`Mise à jour terminée. Un nouveau bilan est publié : données jusqu’au ${date}`),
		failed: (time: string) => sentence(`Actualisation impossible. Données affichées : ${time}`),
	},
};
