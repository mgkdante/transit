import { defineCopy, type Locale } from '$lib/i18n';

export type LegalPageKind = 'privacy' | 'terms';
export const LEGAL_EFFECTIVE_DATE = '2026-09-01';

export interface LegalLinkCopy {
	readonly href: string;
	readonly label: string;
}

export interface LegalSectionCopy {
	readonly id: string;
	readonly title: string;
	readonly paragraphs: readonly string[];
	readonly bullets?: readonly string[];
	readonly links?: readonly LegalLinkCopy[];
}

export interface LegalDocumentCopy {
	readonly kicker: string;
	readonly title: string;
	readonly effectiveLabel: string;
	readonly effectiveDate: string;
	readonly summary: string;
	readonly sections: readonly LegalSectionCopy[];
}

export const legalCopy = defineCopy({
	fr: {
		footerAttribution:
			'Les droits liés au code ouvert et au contenu tiers sont indiqués dans les conditions, le fichier NOTICE et les crédits de source.',
	},
	en: {
		footerAttribution:
			'Open-source and third-party rights are identified in the Terms, NOTICE file and source credits.',
	},
});

const documents = {
	en: {
		privacy: {
			kicker: 'LEGAL',
			title: 'Privacy Policy',
			effectiveLabel: 'Effective and last updated',
			effectiveDate: 'September 1, 2026',
			summary:
				'This policy explains the limited personal information processing involved when you use Transit. Transit has no user accounts, payments, advertising, newsletter or direct marketing.',
			sections: [
				{
					id: 'operator',
					title: 'Operator and Privacy Officer',
					paragraphs: [
						'Transit is a public transit information and portfolio project operated by Yesid Fernando Otalora, a sole proprietor in Quebec, Canada.',
						'Yesid Fernando Otalora is the person in charge of the protection of personal information for Transit. Title: Privacy Officer. Contact: contact@yesid.dev.',
					],
				},
				{
					id: 'processing',
					title: 'Information processed when you visit',
					paragraphs: [
						'Cloudflare delivers and protects the site. It processes ordinary network request information, such as an IP address, request path, headers and security signals, to route requests, prevent abuse and operate the service.',
						'Transit uses Cloudflare managed Web Analytics. Its beacon processes page-load timing and Web Vitals, page path, referrer, country, device, browser and operating-system information. Cloudflare says Web Analytics uses no cookies or localStorage and does not use IP addresses, user-agent strings or other data to fingerprint individuals for analytics display. Query strings are not logged by Web Analytics.',
						'Cloudflare keeps unsampled beacon data for seven days, then aggregates approximately 10% for longer-term storage. Transit can access the previous six months in the dashboard. These periods do not describe all Cloudflare delivery or security records.',
					],
					links: [
						{
							href: 'https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/',
							label: 'Cloudflare Web Analytics data collection',
						},
						{
							href: 'https://developers.cloudflare.com/web-analytics/faq/',
							label: 'Cloudflare Web Analytics retention FAQ',
						},
					],
				},
				{
					id: 'search-location',
					title: 'Address search and device location',
					paragraphs: [
						'When you type an address or place into map search, the query is sent to the Transit server and then to the Government of Canada Geo.ca geolocation service. Geo.ca receives the query from Transit, not a direct browser request from you.',
						'When you select a result, its normalized label, coordinates and precision are written to the page URL so the view can be restored or shared. Anyone who receives that URL can see those values. Clearing the selected location removes them. Do not select a sensitive address before sharing a map link.',
						'The Transit server uses the connecting IP address only in a best-effort, in-memory rate-limit table local to each Worker isolate. It is capped at 10,000 IP entries per isolate; inactive entries become eligible for removal after ten minutes, and isolate turnover resets it. The application does not write that table to persistent storage. Cloudflare and Geo.ca may separately process requests under their own practices.',
						'If you choose “Use my location,” your browser asks for permission. The coordinates stay in your browser and are used only to centre the map and sort nearby stops. Transit does not add them to the URL or send them to its server.',
					],
					links: [
						{
							href: 'https://natural-resources.canada.ca/maps-tools-publications/satellite-elevation-air-photos/geolocation-service',
							label: 'Government of Canada Geo.ca geolocation service',
						},
					],
				},
				{
					id: 'device-storage',
					title: 'Storage on your device',
					paragraphs: [
						'Transit uses localStorage and sessionStorage for interface preferences such as theme, quiet mode and open or closed detail panels. Local preferences remain until you change them or clear site data; session values end with the browser session.',
						'A service worker may cache application-shell and static files for speed and offline-safe loading until an update, removal or browser-data clearing. It excludes live /data and /v1 transit snapshots and does not retain them as a personal history.',
					],
				},
				{
					id: 'choices',
					title: 'Your choices and consent',
					paragraphs: [
						'Where consent is the basis for processing, you may withdraw it for future processing. You can deny or revoke device-location permission in your browser, clear a selected map location and clear browser storage. Those choices may disable the related convenience feature.',
						'Essential request delivery, security and abuse prevention are necessary to provide the public website and cannot be disabled through Transit settings.',
					],
				},
				{
					id: 'purposes-sharing',
					title: 'Purposes and sharing',
					paragraphs: [
						'The information above is processed only to deliver and secure Transit, answer an address search, remember your interface choices, diagnose reliability and understand aggregate performance.',
						'Transit does not sell or rent personal information and does not use it for advertising or direct marketing. Information may be handled by Cloudflare and the Government of Canada service described above, or disclosed when required by law.',
						'Provider processing may occur outside Quebec. Cloudflare states that it primarily stores information in the United States and the European Economic Area. Information processed elsewhere may be subject to the laws of that location. This policy does not claim a particular Cloudflare data-localization configuration.',
					],
					links: [
						{
							href: 'https://www.cloudflare.com/privacypolicy/',
							label: 'Cloudflare Privacy Policy',
						},
					],
				},
				{
					id: 'retention-security',
					title: 'Retention and safeguards',
					paragraphs: [
						'Transit keeps no account profile or payment record because those features do not exist. The in-memory geocode rate limit is short-lived as described above. Browser preferences remain under your browser’s control. Cloudflare controls the retention of its network and analytics records under its own policies.',
						'Code-visible safeguards include same-origin checks on geocode requests, bounded input validation and rate limiting, private no-store geocode responses, and Cloudflare delivery and security controls. No Internet service or transmission method is completely secure.',
					],
				},
				{
					id: 'rights',
					title: 'Your rights',
					paragraphs: [
						'You may ask whether Transit holds personal information about you and request access, correction or portability where applicable. You may also withdraw consent for future processing where consent applies.',
						'Send a written request to contact@yesid.dev with the right you want to exercise and enough detail to locate the information. Identity may need to be verified. A written response to an access or correction request will be provided within 30 days.',
						'To make a complaint, email the same address with the concern, what happened and the resolution requested. The Privacy Officer handles requests, complaints and incidents and reviews the practices and providers described here. If a concern is not resolved, you may contact the Commission d’accès à l’information du Québec.',
					],
					links: [
						{
							href: 'mailto:contact@yesid.dev',
							label: 'Email the Transit Privacy Officer',
						},
						{
							href: 'https://www.cai.gouv.qc.ca/',
							label: 'Commission d’accès à l’information du Québec',
						},
					],
				},
				{
					id: 'changes',
					title: 'Changes and contact',
					paragraphs: [
						'This policy may change when Transit, its providers or applicable requirements change. The effective and last-updated date above identifies the current version. When this policy is amended, a notice will be published on this page or elsewhere on the site when the amendment takes effect.',
						'Questions about this policy are welcome in English or French at contact@yesid.dev.',
					],
				},
			],
		},
		terms: {
			kicker: 'LEGAL',
			title: 'Terms of Use',
			effectiveLabel: 'Effective and last updated',
			effectiveDate: 'September 1, 2026',
			summary:
				'These terms govern the hosted Transit website and public data endpoints. Repository source is licensed separately. Transit is an independent informational project, not an official transit-agency service.',
			sections: [
				{
					id: 'operator-acceptance',
					title: 'Operator and acceptance',
					paragraphs: [
						'Transit is operated by Yesid Fernando Otalora, a sole proprietor in Quebec, Canada. By using the hosted service, you agree to these terms. If you do not agree, do not use the service.',
					],
				},
				{
					id: 'information',
					title: 'Information only',
					paragraphs: [
						'Transit presents public transit data, derived reliability measures and explanatory material. Source feeds may be late, incomplete, unavailable or corrected after publication.',
						'Do not rely on Transit for emergencies, personal safety, guaranteed arrival times or decisions where an error could cause harm. Confirm time-sensitive travel information with the applicable transit agency.',
					],
				},
				{
					id: 'independence',
					title: 'Independent project',
					paragraphs: [
						'Transit is not affiliated with, sponsored by or endorsed by STM, OC Transpo or the City of Ottawa, STO, the Government of Canada or Natural Resources Canada, the OpenStreetMap Foundation, or Protomaps. Their names and marks remain those of their respective owners; data and other material are governed by the cited source licences and terms.',
					],
				},
				{
					id: 'licenses',
					title: 'Software, data and attribution',
					paragraphs: [
						'These terms govern the hosted website and public endpoints. Use and reuse of repository source are governed by its LICENSE, NOTICE and applicable GitHub terms.',
						'Original Transit software is available under the MIT License. That license does not relicense transit-agency data, map material, fonts, trademarks or other third-party content.',
						'The repository NOTICE file, provider manifests and visible map or data credits identify the applicable sources and terms. Those third-party terms control your reuse of their material.',
						'STM data is credited to Société de transport de Montréal and used under CC BY 4.0. OC Transpo material retains the statement “Contains information licensed under the Open Government Licence – City of Ottawa.” OpenStreetMap data is available under ODbL and credited as © OpenStreetMap contributors; Protomaps basemap credit remains visible. The STO provider is inactive and no STO data is published.',
					],
					links: [
						{
							href: 'https://github.com/mgkdante/transit/blob/main/LICENSE',
							label: 'Transit MIT License',
						},
						{
							href: 'https://github.com/mgkdante/transit/blob/main/NOTICE',
							label: 'Transit notices and attribution',
						},
						{
							href: 'https://www.openstreetmap.org/copyright',
							label: 'OpenStreetMap copyright and ODbL information',
						},
					],
				},
				{
					id: 'acceptable-use',
					title: 'Acceptable use and security',
					paragraphs: [
						'You may use the public site and endpoints lawfully. Do not disrupt the service, bypass access controls, impose unreasonable load, access information that is not yours or test production in a way that creates risk or cost.',
						'Report suspected vulnerabilities through the private reporting path in the repository Security Policy. Do not publish exploit details before a safe fix can be coordinated.',
					],
					links: [
						{
							href: 'https://github.com/mgkdante/transit/security/policy',
							label: 'Transit Security Policy',
						},
					],
				},
				{
					id: 'warranty-liability',
					title: 'No warranty and limitation of liability',
					paragraphs: [
						'Transit is provided “as is” and “as available,” without a promise that it will be uninterrupted, current, complete or error-free.',
						'To the extent permitted by applicable law, the operator is not liable for indirect, incidental or consequential loss arising from use of Transit or reliance on its content. Nothing in these terms limits liability that cannot legally be excluded under Quebec law, including liability for intentional or gross fault or for bodily or moral injury.',
					],
				},
				{
					id: 'links-law-changes',
					title: 'Third-party links, governing law and changes',
					paragraphs: [
						'Links and embedded source references lead to services Transit does not control. Their terms and privacy practices apply when you use them.',
						'These terms are governed by the laws of Quebec and the applicable laws of Canada. Subject to any mandatory rule that grants another forum, disputes relating to Transit fall within the competent courts of the judicial district of Montreal.',
						'These terms may change when Transit, its providers or applicable requirements change. The effective date above identifies the current version. Questions are welcome at contact@yesid.dev.',
					],
					links: [
						{
							href: 'mailto:contact@yesid.dev',
							label: 'Contact the operator',
						},
					],
				},
			],
		},
	},
	fr: {
		privacy: {
			kicker: 'JURIDIQUE',
			title: 'Politique de confidentialité',
			effectiveLabel: 'Entrée en vigueur et dernière mise à jour',
			effectiveDate: '1er septembre 2026',
			summary:
				'La présente politique explique le traitement limité de renseignements personnels lié à l’utilisation de Transit. Transit ne propose aucun compte, paiement, publicité, infolettre ni marketing direct.',
			sections: [
				{
					id: 'operator',
					title: 'Exploitant et responsable de la protection des renseignements personnels',
					paragraphs: [
						'Transit est un projet d’information sur le transport collectif et de portfolio accessible au public, exploité par Yesid Fernando Otalora, travailleur autonome exploitant une entreprise individuelle au Québec, au Canada.',
						'Yesid Fernando Otalora est la personne responsable de la protection des renseignements personnels pour Transit. Titre : Responsable de la protection des renseignements personnels. Contact : contact@yesid.dev.',
					],
				},
				{
					id: 'processing',
					title: 'Renseignements traités lors d’une visite',
					paragraphs: [
						'Cloudflare livre et protège le site. L’entreprise traite des renseignements ordinaires liés aux requêtes réseau, comme l’adresse IP, le chemin demandé, les en-têtes et les signaux de sécurité, afin d’acheminer les requêtes, de prévenir les abus et d’exploiter le service.',
						'Transit utilise le service Web Analytics géré par Cloudflare. Sa balise traite les temps de chargement et les Web Vitals, le chemin de la page, le référent, le pays, l’appareil, le navigateur et le système d’exploitation. Cloudflare indique que Web Analytics n’utilise ni témoins ni localStorage et n’emploie pas l’adresse IP, la chaîne d’agent utilisateur ou d’autres données pour créer une empreinte des personnes dans l’affichage analytique. Web Analytics ne consigne pas les chaînes de requête.',
						'Cloudflare conserve les données de balise non échantillonnées pendant sept jours, puis agrège environ 10 % pour une conservation à plus long terme. Transit peut consulter les six mois précédents dans le tableau de bord. Ces périodes ne décrivent pas tous les registres de livraison ou de sécurité de Cloudflare.',
					],
					links: [
						{
							href: 'https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/',
							label: 'Collecte de données de Cloudflare Web Analytics',
						},
						{
							href: 'https://developers.cloudflare.com/web-analytics/faq/',
							label: 'FAQ de Cloudflare Web Analytics sur la conservation',
						},
					],
				},
				{
					id: 'search-location',
					title: 'Recherche d’adresse et localisation de l’appareil',
					paragraphs: [
						'Lorsque vous saisissez une adresse ou un lieu dans la recherche cartographique, la requête est envoyée au serveur de Transit, puis au service de géolocalisation Geo.ca du gouvernement du Canada. Geo.ca reçoit la requête de Transit, et non une requête directe de votre navigateur.',
						'Lorsque vous sélectionnez un résultat, son libellé normalisé, ses coordonnées et son niveau de précision sont inscrits dans l’URL afin de restaurer ou de partager la vue. Toute personne qui reçoit cette URL peut voir ces valeurs. L’effacement du lieu sélectionné les retire. Ne sélectionnez pas une adresse sensible avant de partager un lien cartographique.',
						'Le serveur Transit utilise l’adresse IP de connexion uniquement dans une table antiabus en mémoire propre à chaque instance d’exécution Cloudflare Worker. Elle est limitée à 10 000 entrées d’adresse IP par instance; les entrées inactives peuvent être retirées après dix minutes, et le remplacement de l’instance la réinitialise. L’application n’écrit pas cette table dans un stockage persistant. Cloudflare et Geo.ca peuvent traiter séparément les requêtes selon leurs propres pratiques.',
						'Si vous choisissez « Utiliser ma position », votre navigateur demande votre permission. Les coordonnées restent dans votre navigateur et servent seulement à centrer la carte et à trier les arrêts à proximité. Transit ne les ajoute pas à l’URL et ne les envoie pas à son serveur.',
					],
					links: [
						{
							href: 'https://ressources-naturelles.canada.ca/carte-outils-publications/imagerie-satellitaire-donnees-elevation-photos-aeriennes/service-geolocalisation',
							label: 'Service de géolocalisation Geo.ca du gouvernement du Canada',
						},
					],
				},
				{
					id: 'device-storage',
					title: 'Stockage sur votre appareil',
					paragraphs: [
						'Transit utilise localStorage et sessionStorage pour des préférences d’interface, comme le thème, le mode discret et l’ouverture de certains panneaux. Les préférences locales restent jusqu’à leur modification ou l’effacement des données du site; les valeurs de session prennent fin avec la session du navigateur.',
						'Un service worker peut mettre en cache l’enveloppe de l’application et des fichiers statiques afin d’accélérer le chargement et de fournir un repli hors ligne, jusqu’à une mise à jour, son retrait ou l’effacement des données du navigateur. Il exclut les instantanés de transport en direct sous /data et /v1 et ne les conserve pas comme historique personnel.',
					],
				},
				{
					id: 'choices',
					title: 'Vos choix et votre consentement',
					paragraphs: [
						'Lorsque le consentement fonde un traitement, vous pouvez le retirer pour l’avenir. Vous pouvez refuser ou révoquer la permission de localisation dans votre navigateur, effacer un lieu sélectionné et supprimer les données du navigateur. Ces choix peuvent désactiver la fonction pratique concernée.',
						'La livraison essentielle des requêtes, la sécurité et la prévention des abus sont nécessaires pour fournir le site public et ne peuvent pas être désactivées dans les réglages de Transit.',
					],
				},
				{
					id: 'purposes-sharing',
					title: 'Finalités et communication',
					paragraphs: [
						'Les renseignements décrits ci-dessus sont traités uniquement pour livrer et protéger Transit, répondre à une recherche d’adresse, mémoriser vos choix d’interface, diagnostiquer la fiabilité et comprendre la performance globale.',
						'Transit ne vend ni ne loue de renseignements personnels et ne les utilise pas à des fins de publicité ou de marketing direct. Des renseignements peuvent être traités par Cloudflare et le service du gouvernement du Canada décrit ci-dessus, ou communiqués lorsque la loi l’exige.',
						'Le traitement par les fournisseurs peut avoir lieu à l’extérieur du Québec. Cloudflare indique stocker principalement les renseignements aux États-Unis et dans l’Espace économique européen. Les renseignements traités ailleurs peuvent être assujettis aux lois de cet endroit. La présente politique ne prétend pas qu’une configuration particulière de localisation des données Cloudflare est activée.',
					],
					links: [
						{
							href: 'https://www.cloudflare.com/fr-fr/privacypolicy/',
							label: 'Politique de confidentialité de Cloudflare',
						},
					],
				},
				{
					id: 'retention-security',
					title: 'Conservation et mesures de protection',
					paragraphs: [
						'Transit ne conserve aucun profil de compte ni dossier de paiement, puisque ces fonctions n’existent pas. La limite de recherche en mémoire est de courte durée, comme décrit ci-dessus. Les préférences du navigateur restent sous votre contrôle. Cloudflare contrôle la conservation de ses registres réseau et d’analyse selon ses propres politiques.',
						'Les mesures visibles dans le code comprennent des contrôles de même origine sur les requêtes de géocodage, une validation et une limitation bornées des entrées, des réponses de géocodage privées sans mise en cache et les contrôles de livraison et de sécurité de Cloudflare. Aucun service Internet ni mode de transmission n’est entièrement sûr.',
					],
				},
				{
					id: 'rights',
					title: 'Vos droits',
					paragraphs: [
						'Vous pouvez demander si Transit détient des renseignements personnels à votre sujet et demander leur accès, leur rectification ou leur portabilité, lorsque ces droits s’appliquent. Vous pouvez aussi retirer votre consentement pour l’avenir lorsque le traitement repose sur celui-ci.',
						'Envoyez une demande écrite à contact@yesid.dev en indiquant le droit exercé et assez de détails pour retrouver les renseignements. Votre identité peut devoir être vérifiée. Une réponse écrite à une demande d’accès ou de rectification sera fournie dans les 30 jours.',
						'Pour déposer une plainte, écrivez à la même adresse en décrivant la préoccupation, les faits et la solution demandée. Le responsable traite les demandes, plaintes et incidents et révise les pratiques et fournisseurs décrits ici. Si une préoccupation n’est pas résolue, vous pouvez vous adresser à la Commission d’accès à l’information du Québec.',
					],
					links: [
						{
							href: 'mailto:contact@yesid.dev',
							label: 'Écrire au responsable de Transit',
						},
						{
							href: 'https://www.cai.gouv.qc.ca/',
							label: 'Commission d’accès à l’information du Québec',
						},
					],
				},
				{
					id: 'changes',
					title: 'Modifications et contact',
					paragraphs: [
						'La présente politique peut changer lorsque Transit, ses fournisseurs ou les exigences applicables changent. La date d’entrée en vigueur et de dernière mise à jour ci-dessus indique la version actuelle. Lorsque la présente politique est modifiée, un avis est publié sur cette page ou ailleurs sur le site au moment de l’entrée en vigueur de la modification.',
						'Les questions sur cette politique sont les bienvenues en français ou en anglais à contact@yesid.dev.',
					],
				},
			],
		},
		terms: {
			kicker: 'JURIDIQUE',
			title: 'Conditions d’utilisation',
			effectiveLabel: 'Entrée en vigueur et dernière mise à jour',
			effectiveDate: '1er septembre 2026',
			summary:
				'Les présentes conditions régissent le site Transit hébergé et ses points de terminaison publics. Le code du dépôt est offert sous une licence distincte. Transit est un projet d’information indépendant, et non un service officiel d’une société de transport.',
			sections: [
				{
					id: 'operator-acceptance',
					title: 'Exploitant et acceptation',
					paragraphs: [
						'Transit est exploité par Yesid Fernando Otalora, travailleur autonome exploitant une entreprise individuelle au Québec, au Canada. En utilisant le service hébergé, vous acceptez les présentes conditions. Si vous ne les acceptez pas, n’utilisez pas le service.',
					],
				},
				{
					id: 'information',
					title: 'Information seulement',
					paragraphs: [
						'Transit présente des données publiques de transport collectif, des mesures de fiabilité dérivées et du contenu explicatif. Les flux de source peuvent être en retard, incomplets, indisponibles ou corrigés après leur publication.',
						'Ne vous fiez pas à Transit pour une urgence, votre sécurité, une heure d’arrivée garantie ou une décision dont l’erreur pourrait causer un préjudice. Confirmez les renseignements de déplacement sensibles au temps auprès de la société de transport concernée.',
					],
				},
				{
					id: 'independence',
					title: 'Projet indépendant',
					paragraphs: [
						'Transit n’est ni affilié, ni commandité, ni approuvé par la STM, OC Transpo ou la Ville d’Ottawa, la STO, le gouvernement du Canada ou Ressources naturelles Canada, la Fondation OpenStreetMap, ou Protomaps. Leurs noms et marques demeurent ceux de leurs propriétaires respectifs; les données et autres éléments sont régis par les licences et conditions de source citées.',
					],
				},
				{
					id: 'licenses',
					title: 'Logiciel, données et attribution',
					paragraphs: [
						'Les présentes conditions régissent le site hébergé et les points de terminaison publics. L’utilisation et la réutilisation du code du dépôt sont régies par ses fichiers LICENSE et NOTICE ainsi que par les conditions applicables de GitHub.',
						'Le logiciel original de Transit est offert selon la licence MIT. Cette licence ne remet pas sous licence les données des sociétés de transport, le contenu cartographique, les polices, les marques de commerce ni les autres éléments de tiers.',
						'Le fichier NOTICE du dépôt, les manifestes de fournisseur et les crédits visibles de carte ou de données indiquent les sources et conditions applicables. Ces conditions de tiers régissent la réutilisation de leur contenu.',
						'Les données de la STM sont attribuées à la Société de transport de Montréal et utilisées selon CC BY 4.0. Le contenu d’OC Transpo conserve la mention « Contains information licensed under the Open Government Licence – City of Ottawa. » Les données OpenStreetMap sont offertes selon l’ODbL et attribuées par la mention © contributeurs OpenStreetMap; le crédit de fond de carte Protomaps demeure visible. Le fournisseur STO est inactif et aucune donnée STO n’est publiée.',
					],
					links: [
						{
							href: 'https://github.com/mgkdante/transit/blob/main/LICENSE',
							label: 'Licence MIT de Transit',
						},
						{
							href: 'https://github.com/mgkdante/transit/blob/main/NOTICE',
							label: 'Mentions et attributions de Transit',
						},
						{
							href: 'https://www.openstreetmap.org/copyright',
							label: 'Droits d’auteur et renseignements ODbL d’OpenStreetMap',
						},
					],
				},
				{
					id: 'acceptable-use',
					title: 'Utilisation acceptable et sécurité',
					paragraphs: [
						'Vous pouvez utiliser le site public et ses points de terminaison conformément à la loi. Vous ne devez pas perturber le service, contourner des contrôles d’accès, imposer une charge déraisonnable, accéder à des renseignements qui ne vous appartiennent pas ni tester la production d’une manière qui crée un risque ou un coût.',
						'Signalez toute vulnérabilité présumée au moyen du canal privé indiqué dans la politique de sécurité du dépôt. Ne publiez pas de détails d’exploitation avant qu’une correction sûre puisse être coordonnée.',
					],
					links: [
						{
							href: 'https://github.com/mgkdante/transit/security/policy',
							label: 'Politique de sécurité de Transit',
						},
					],
				},
				{
					id: 'warranty-liability',
					title: 'Absence de garantie et limitation de responsabilité',
					paragraphs: [
						'Transit est fourni « tel quel » et « selon sa disponibilité », sans promesse de fonctionnement ininterrompu, actuel, complet ou exempt d’erreurs.',
						'Dans la mesure permise par la loi applicable, l’exploitant n’est pas responsable des pertes indirectes, accessoires ou consécutives découlant de l’utilisation de Transit ou de la confiance accordée à son contenu. Rien dans les présentes conditions ne limite une responsabilité qui ne peut légalement être exclue au Québec, notamment en cas de faute intentionnelle ou lourde ou de préjudice corporel ou moral.',
					],
				},
				{
					id: 'links-law-changes',
					title: 'Liens de tiers, droit applicable et modifications',
					paragraphs: [
						'Les liens et références de source mènent à des services que Transit ne contrôle pas. Leurs conditions et pratiques de confidentialité s’appliquent lorsque vous les utilisez.',
						'Les présentes conditions sont régies par les lois du Québec et les lois applicables du Canada. Sous réserve de toute règle impérative accordant un autre for, les litiges relatifs à Transit relèvent des tribunaux compétents du district judiciaire de Montréal.',
						'Les présentes conditions peuvent changer lorsque Transit, ses fournisseurs ou les exigences applicables changent. La date d’entrée en vigueur ci-dessus indique la version actuelle. Les questions sont les bienvenues à contact@yesid.dev.',
					],
					links: [
						{
							href: 'mailto:contact@yesid.dev',
							label: 'Communiquer avec l’exploitant',
						},
					],
				},
			],
		},
	},
} as const satisfies Record<Locale, Record<LegalPageKind, LegalDocumentCopy>>;

export function legalDocument(locale: Locale, kind: LegalPageKind): LegalDocumentCopy {
	return documents[locale][kind];
}
