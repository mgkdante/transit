<script lang="ts">
	let { class: className = '', ...rest }: { class?: string; style?: string; [key: string]: unknown } = $props();
</script>

<svg class={className} {...rest} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 400" fill="none">
  <defs>
    <style>
      .outline { stroke: currentColor; stroke-width: 2; fill: none; }
      .detail { stroke: currentColor; stroke-width: 1; fill: none; }
      .fine { stroke: currentColor; stroke-width: 0.5; fill: none; }
      .hidden { stroke: currentColor; stroke-width: 0.5; fill: none; stroke-dasharray: 6 3; }
      .dim-line { stroke: currentColor; stroke-width: 0.5; fill: none; }
      .dim-text { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 11px; fill: currentColor; text-anchor: middle; }
      .title-text { font-family: 'Inter', 'Helvetica Neue', sans-serif; font-size: 16px; font-weight: 700; fill: currentColor; letter-spacing: 0.1em; }
      .label-text { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 9px; fill: currentColor; text-anchor: middle; }
      .tick { stroke: currentColor; stroke-width: 0.5; }
    </style>
  </defs>

  <!-- ============================== -->
  <!-- TITLE                          -->
  <!-- ============================== -->
  <text x="900" y="28" class="title-text" text-anchor="middle">MPM-10 · PLAN VIEW (END CAR)</text>

  <!-- ============================== -->
  <!-- MAIN BODY OUTLINE              -->
  <!-- ============================== -->
  <!-- Car body: centered vertically at y=200, width mapped to ~1520px (16,900mm), body width ~225px (2,514mm) -->
  <!-- Body spans x=140 to x=1660, y=88 to y=312 -->

  <!-- Left side wall (top in plan view) -->
  <!-- Nose taper starts at x=140, body full width at x=280 -->
  <!-- Rear gangway opening at x=1660 -->

  <!-- Nose / front aerodynamic shape -->
  <path d="
    M 280 88
    Q 200 88, 165 130
    Q 148 155, 145 175
    Q 142 190, 142 200
    Q 142 210, 145 225
    Q 148 245, 165 270
    Q 200 312, 280 312
  " class="outline"/>

  <!-- Top wall: from nose join to first door -->
  <line x1="280" y1="88" x2="460" y2="88" class="outline"/>
  <!-- Door 1 gap top (460 to 608 = 148px ~ 1650mm) -->
  <!-- Top wall: after door 1 to door 2 -->
  <line x1="608" y1="88" x2="808" y2="88" class="outline"/>
  <!-- Door 2 gap top (808 to 956) -->
  <!-- Top wall: after door 2 to door 3 -->
  <line x1="956" y1="88" x2="1156" y2="88" class="outline"/>
  <!-- Door 3 gap top (1156 to 1304) -->
  <!-- Top wall: after door 3 to rear -->
  <line x1="1304" y1="88" x2="1660" y2="88" class="outline"/>

  <!-- Bottom wall: from nose join to first door -->
  <line x1="280" y1="312" x2="460" y2="312" class="outline"/>
  <!-- Door 1 gap bottom -->
  <!-- Bottom wall: after door 1 to door 2 -->
  <line x1="608" y1="312" x2="808" y2="312" class="outline"/>
  <!-- Door 2 gap bottom -->
  <!-- Bottom wall: after door 2 to door 3 -->
  <line x1="956" y1="312" x2="1156" y2="312" class="outline"/>
  <!-- Door 3 gap bottom -->
  <!-- Bottom wall: after door 3 to rear -->
  <line x1="1304" y1="312" x2="1660" y2="312" class="outline"/>

  <!-- Rear wall with gangway opening -->
  <!-- Gangway opening: 1300mm = ~117px, centered at y=200: y=141.5 to y=258.5 -->
  <line x1="1660" y1="88" x2="1660" y2="141" class="outline"/>
  <line x1="1660" y1="259" x2="1660" y2="312" class="outline"/>

  <!-- Gangway connector frame -->
  <rect x="1660" y="141" width="30" height="118" rx="2" class="detail"/>

  <!-- ============================== -->
  <!-- DOOR OPENINGS (6 total, 3/side)-->
  <!-- ============================== -->

  <!-- Door 1 — Top side -->
  <line x1="460" y1="85" x2="460" y2="91" class="detail"/>
  <line x1="608" y1="85" x2="608" y2="91" class="detail"/>
  <!-- Bi-parting panels (top) -->
  <line x1="460" y1="82" x2="534" y2="82" class="fine"/>
  <line x1="534" y1="82" x2="608" y2="82" class="fine"/>
  <line x1="534" y1="80" x2="534" y2="84" class="fine"/>
  <!-- Door slide arrows -->
  <line x1="480" y1="82" x2="470" y2="79" class="fine"/>
  <line x1="480" y1="82" x2="470" y2="85" class="fine"/>
  <line x1="588" y1="82" x2="598" y2="79" class="fine"/>
  <line x1="588" y1="82" x2="598" y2="85" class="fine"/>

  <!-- Door 2 — Top side -->
  <line x1="808" y1="85" x2="808" y2="91" class="detail"/>
  <line x1="956" y1="85" x2="956" y2="91" class="detail"/>
  <line x1="808" y1="82" x2="882" y2="82" class="fine"/>
  <line x1="882" y1="82" x2="956" y2="82" class="fine"/>
  <line x1="882" y1="80" x2="882" y2="84" class="fine"/>
  <line x1="828" y1="82" x2="818" y2="79" class="fine"/>
  <line x1="828" y1="82" x2="818" y2="85" class="fine"/>
  <line x1="936" y1="82" x2="946" y2="79" class="fine"/>
  <line x1="936" y1="82" x2="946" y2="85" class="fine"/>

  <!-- Door 3 — Top side -->
  <line x1="1156" y1="85" x2="1156" y2="91" class="detail"/>
  <line x1="1304" y1="85" x2="1304" y2="91" class="detail"/>
  <line x1="1156" y1="82" x2="1230" y2="82" class="fine"/>
  <line x1="1230" y1="82" x2="1304" y2="82" class="fine"/>
  <line x1="1230" y1="80" x2="1230" y2="84" class="fine"/>
  <line x1="1176" y1="82" x2="1166" y2="79" class="fine"/>
  <line x1="1176" y1="82" x2="1166" y2="85" class="fine"/>
  <line x1="1284" y1="82" x2="1294" y2="79" class="fine"/>
  <line x1="1284" y1="82" x2="1294" y2="85" class="fine"/>

  <!-- Door 1 — Bottom side -->
  <line x1="460" y1="309" x2="460" y2="315" class="detail"/>
  <line x1="608" y1="309" x2="608" y2="315" class="detail"/>
  <line x1="460" y1="318" x2="534" y2="318" class="fine"/>
  <line x1="534" y1="318" x2="608" y2="318" class="fine"/>
  <line x1="534" y1="316" x2="534" y2="320" class="fine"/>
  <line x1="480" y1="318" x2="470" y2="315" class="fine"/>
  <line x1="480" y1="318" x2="470" y2="321" class="fine"/>
  <line x1="588" y1="318" x2="598" y2="315" class="fine"/>
  <line x1="588" y1="318" x2="598" y2="321" class="fine"/>

  <!-- Door 2 — Bottom side -->
  <line x1="808" y1="309" x2="808" y2="315" class="detail"/>
  <line x1="956" y1="309" x2="956" y2="315" class="detail"/>
  <line x1="808" y1="318" x2="882" y2="318" class="fine"/>
  <line x1="882" y1="318" x2="956" y2="318" class="fine"/>
  <line x1="882" y1="316" x2="882" y2="320" class="fine"/>
  <line x1="828" y1="318" x2="818" y2="315" class="fine"/>
  <line x1="828" y1="318" x2="818" y2="321" class="fine"/>
  <line x1="936" y1="318" x2="946" y2="315" class="fine"/>
  <line x1="936" y1="318" x2="946" y2="321" class="fine"/>

  <!-- Door 3 — Bottom side -->
  <line x1="1156" y1="309" x2="1156" y2="315" class="detail"/>
  <line x1="1304" y1="309" x2="1304" y2="315" class="detail"/>
  <line x1="1156" y1="318" x2="1230" y2="318" class="fine"/>
  <line x1="1230" y1="318" x2="1304" y2="318" class="fine"/>
  <line x1="1230" y1="316" x2="1230" y2="320" class="fine"/>
  <line x1="1176" y1="318" x2="1166" y2="315" class="fine"/>
  <line x1="1176" y1="318" x2="1166" y2="321" class="fine"/>
  <line x1="1284" y1="318" x2="1294" y2="315" class="fine"/>
  <line x1="1284" y1="318" x2="1294" y2="321" class="fine"/>

  <!-- ============================== -->
  <!-- WINDSHIELD                     -->
  <!-- ============================== -->
  <path d="
    M 240 108
    Q 195 130, 178 160
    Q 168 180, 166 200
    Q 168 220, 178 240
    Q 195 270, 240 292
  " class="detail"/>

  <!-- Windshield inner edge -->
  <path d="
    M 252 118
    Q 212 138, 198 164
    Q 190 182, 188 200
    Q 190 218, 198 236
    Q 212 262, 252 282
  " class="fine"/>

  <!-- ============================== -->
  <!-- CAB CONSOLE                    -->
  <!-- ============================== -->
  <rect x="260" y="172" width="40" height="56" rx="4" class="detail"/>
  <!-- Console details -->
  <line x1="265" y1="182" x2="295" y2="182" class="fine"/>
  <line x1="265" y1="192" x2="295" y2="192" class="fine"/>
  <line x1="265" y1="208" x2="295" y2="208" class="fine"/>
  <line x1="265" y1="218" x2="295" y2="218" class="fine"/>

  <!-- ============================== -->
  <!-- LONGITUDINAL BENCH SEATING     -->
  <!-- ============================== -->

  <!-- Top side benches (dashed = hidden under roof line) -->
  <!-- Section 1: between cab and door 1 -->
  <rect x="320" y="96" width="130" height="30" rx="2" class="hidden"/>
  <!-- Section 2: between door 1 and door 2 -->
  <rect x="618" y="96" width="180" height="30" rx="2" class="hidden"/>
  <!-- Section 3: between door 2 and door 3 -->
  <rect x="966" y="96" width="180" height="30" rx="2" class="hidden"/>
  <!-- Section 4: between door 3 and rear -->
  <rect x="1314" y="96" width="330" height="30" rx="2" class="hidden"/>

  <!-- Bottom side benches -->
  <!-- Section 1: between cab and door 1 -->
  <rect x="320" y="274" width="130" height="30" rx="2" class="hidden"/>
  <!-- Section 2: between door 1 and door 2 -->
  <rect x="618" y="274" width="180" height="30" rx="2" class="hidden"/>
  <!-- Section 3: between door 2 and door 3 -->
  <rect x="966" y="274" width="180" height="30" rx="2" class="hidden"/>
  <!-- Section 4: between door 3 and rear -->
  <rect x="1314" y="274" width="330" height="30" rx="2" class="hidden"/>

  <!-- ============================== -->
  <!-- CENTER AISLE                   -->
  <!-- ============================== -->
  <line x1="310" y1="175" x2="1650" y2="175" class="hidden"/>
  <line x1="310" y1="225" x2="1650" y2="225" class="hidden"/>

  <!-- ============================== -->
  <!-- ROOF-MOUNTED HVAC UNIT         -->
  <!-- ============================== -->
  <rect x="700" y="158" width="500" height="84" rx="6" class="detail"/>
  <!-- HVAC internal divisions -->
  <line x1="825" y1="158" x2="825" y2="242" class="fine"/>
  <line x1="950" y1="158" x2="950" y2="242" class="fine"/>
  <line x1="1075" y1="158" x2="1075" y2="242" class="fine"/>
  <!-- HVAC grille pattern -->
  <line x1="720" y1="175" x2="810" y2="175" class="fine"/>
  <line x1="720" y1="190" x2="810" y2="190" class="fine"/>
  <line x1="720" y1="210" x2="810" y2="210" class="fine"/>
  <line x1="720" y1="225" x2="810" y2="225" class="fine"/>
  <line x1="845" y1="175" x2="935" y2="175" class="fine"/>
  <line x1="845" y1="190" x2="935" y2="190" class="fine"/>
  <line x1="845" y1="210" x2="935" y2="210" class="fine"/>
  <line x1="845" y1="225" x2="935" y2="225" class="fine"/>
  <line x1="970" y1="175" x2="1060" y2="175" class="fine"/>
  <line x1="970" y1="190" x2="1060" y2="190" class="fine"/>
  <line x1="970" y1="210" x2="1060" y2="210" class="fine"/>
  <line x1="970" y1="225" x2="1060" y2="225" class="fine"/>
  <line x1="1095" y1="175" x2="1185" y2="175" class="fine"/>
  <line x1="1095" y1="190" x2="1185" y2="190" class="fine"/>
  <line x1="1095" y1="210" x2="1185" y2="210" class="fine"/>
  <line x1="1095" y1="225" x2="1185" y2="225" class="fine"/>
  <!-- HVAC label -->
  <text x="950" y="203" class="label-text">HVAC</text>

  <!-- ============================== -->
  <!-- GRAB POLES (interior details)  -->
  <!-- ============================== -->
  <!-- Vertical poles near doors — shown as small circles -->
  <!-- Door 1 area -->
  <circle cx="468" cy="140" r="3" class="fine"/>
  <circle cx="600" cy="140" r="3" class="fine"/>
  <circle cx="468" cy="260" r="3" class="fine"/>
  <circle cx="600" cy="260" r="3" class="fine"/>
  <!-- Door 2 area -->
  <circle cx="816" cy="140" r="3" class="fine"/>
  <circle cx="948" cy="140" r="3" class="fine"/>
  <circle cx="816" cy="260" r="3" class="fine"/>
  <circle cx="948" cy="260" r="3" class="fine"/>
  <!-- Door 3 area -->
  <circle cx="1164" cy="140" r="3" class="fine"/>
  <circle cx="1296" cy="140" r="3" class="fine"/>
  <circle cx="1164" cy="260" r="3" class="fine"/>
  <circle cx="1296" cy="260" r="3" class="fine"/>

  <!-- ============================== -->
  <!-- DIMENSION ANNOTATIONS          -->
  <!-- ============================== -->

  <!-- Overall length: 16,900 mm -->
  <!-- Dimension line below the car -->
  <line x1="142" y1="355" x2="1690" y2="355" class="dim-line"/>
  <!-- Extension lines -->
  <line x1="142" y1="318" x2="142" y2="360" class="dim-line"/>
  <line x1="1690" y1="318" x2="1690" y2="360" class="dim-line"/>
  <!-- Ticks -->
  <line x1="142" y1="351" x2="142" y2="359" class="tick"/>
  <line x1="1690" y1="351" x2="1690" y2="359" class="tick"/>
  <!-- Arrowheads -->
  <polygon points="142,355 152,352 152,358" fill="currentColor"/>
  <polygon points="1690,355 1680,352 1680,358" fill="currentColor"/>
  <!-- Text -->
  <text x="916" y="370" class="dim-text">16,900 mm</text>

  <!-- Width: 2,514 mm -->
  <!-- Dimension line to the right of the car -->
  <line x1="1730" y1="88" x2="1730" y2="312" class="dim-line"/>
  <!-- Extension lines -->
  <line x1="1665" y1="88" x2="1735" y2="88" class="dim-line"/>
  <line x1="1665" y1="312" x2="1735" y2="312" class="dim-line"/>
  <!-- Ticks -->
  <line x1="1726" y1="88" x2="1734" y2="88" class="tick"/>
  <line x1="1726" y1="312" x2="1734" y2="312" class="tick"/>
  <!-- Arrowheads -->
  <polygon points="1730,88 1727,98 1733,98" fill="currentColor"/>
  <polygon points="1730,312 1727,302 1733,302" fill="currentColor"/>
  <!-- Text (rotated) -->
  <text x="1755" y="204" class="dim-text" transform="rotate(90, 1755, 204)">2,514 mm</text>

  <!-- Door opening: 1,650 mm (annotated on door 2 top side) -->
  <line x1="808" y1="60" x2="956" y2="60" class="dim-line"/>
  <line x1="808" y1="60" x2="808" y2="80" class="dim-line"/>
  <line x1="956" y1="60" x2="956" y2="80" class="dim-line"/>
  <!-- Arrowheads -->
  <polygon points="808,60 818,57 818,63" fill="currentColor"/>
  <polygon points="956,60 946,57 946,63" fill="currentColor"/>
  <text x="882" y="55" class="dim-text">1,650 mm</text>

  <!-- Gangway: 1,300 mm -->
  <line x1="1700" y1="141" x2="1700" y2="259" class="dim-line"/>
  <line x1="1660" y1="141" x2="1705" y2="141" class="dim-line"/>
  <line x1="1660" y1="259" x2="1705" y2="259" class="dim-line"/>
  <!-- Arrowheads -->
  <polygon points="1700,141 1697,151 1703,151" fill="currentColor"/>
  <polygon points="1700,259 1697,249 1703,249" fill="currentColor"/>
  <text x="1700" y="135" class="dim-text">1,300 mm</text>

  <!-- ============================== -->
  <!-- SECTION LABELS                 -->
  <!-- ============================== -->
  <text x="280" y="204" class="label-text">CAB</text>
  <text x="1675" y="204" class="label-text" transform="rotate(90, 1675, 204)">GANGWAY</text>

  <!-- Front indicator arrow -->
  <line x1="142" y1="46" x2="100" y2="46" class="dim-line"/>
  <polygon points="100,46 110,43 110,49" fill="currentColor"/>
  <text x="155" y="50" class="label-text" text-anchor="start">FRONT</text>

  <!-- Rear indicator -->
  <text x="1660" y="50" class="label-text">REAR</text>

  <!-- ============================== -->
  <!-- CENTERLINE                     -->
  <!-- ============================== -->
  <line x1="130" y1="200" x2="1700" y2="200" stroke="currentColor" stroke-width="0.3" stroke-dasharray="12 4 2 4" fill="none" opacity="0.4"/>
</svg>
