export type WizardMood = 'idle' | 'thinking' | 'speaking'

// The Dungeon Master's floating head, drawn in SVG so it needs no assets.
// The beard and hair fade into mist at the bottom (wz-fade mask).
export default function Wizard({ mood }: { mood: WizardMood }) {
  return (
    <div className={`wizard wizard-${mood}`}>
      <svg viewBox="0 0 240 300" role="img" aria-label="Dungeon Master: mago idoso de barba branca trançada, com chapéu vermelho">
        <defs>
          <radialGradient id="wz-aura" cx="50%" cy="45%" r="50%">
            <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.5" />
            <stop offset="55%" stopColor="#d4a247" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#d4a247" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wz-skin" cx="45%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#f4d6ba" />
            <stop offset="70%" stopColor="#dba98a" />
            <stop offset="100%" stopColor="#b9806a" />
          </radialGradient>
          <linearGradient id="wz-hat" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c0392b" />
            <stop offset="55%" stopColor="#8a2a1c" />
            <stop offset="100%" stopColor="#4a140c" />
          </linearGradient>
          <linearGradient id="wz-brim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a8301f" />
            <stop offset="100%" stopColor="#4a140c" />
          </linearGradient>
          <linearGradient id="wz-hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="60%" stopColor="#ece5e9" />
            <stop offset="100%" stopColor="#d9cdd4" />
          </linearGradient>
          <linearGradient id="wz-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1d0a14" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#1d0a14" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wz-fade-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="84%" stopColor="#fff" />
            <stop offset="100%" stopColor="#000" />
          </linearGradient>
          <mask id="wz-fade">
            <rect x="0" y="0" width="240" height="300" fill="url(#wz-fade-grad)" />
          </mask>
          <clipPath id="wz-face">
            <path d="M78 128 C78 112 96 114 120 114 C144 114 162 112 162 128 C164 158 158 184 142 198 C130 207 110 207 98 198 C82 184 76 158 78 128 Z" />
          </clipPath>
        </defs>

        <circle className="wz-aura" cx="120" cy="150" r="118" fill="url(#wz-aura)" />

        <g className="wz-body">
          {/* Straight hair falling at the sides */}
          <g mask="url(#wz-fade)">
            <path d="M88 112 C72 110 60 122 59 146 L58 238 C58 248 63 254 70 254 L80 254 C76 230 74 200 76 168 C78 144 81 126 88 112 Z" fill="#d6cad1" stroke="#7d6e77" strokeWidth="1.2" />
            <path d="M152 112 C168 110 180 122 181 146 L182 238 C182 248 177 254 170 254 L160 254 C164 230 166 200 164 168 C162 144 159 126 152 112 Z" fill="#d6cad1" stroke="#7d6e77" strokeWidth="1.2" />
            <path d="M88 116 C75 115 65 126 64 148 L63 234 C63 242 67 247 73 247 L78 247 C74 224 73 196 75 166 C77 144 81 128 88 116 Z" fill="url(#wz-hair)" />
            <path d="M152 116 C165 115 175 126 176 148 L177 234 C177 242 173 247 167 247 L162 247 C166 224 167 196 165 166 C163 144 159 128 152 116 Z" fill="url(#wz-hair)" />
            <path d="M68 146 L67 240 M74 136 L73 236 M172 146 L173 240 M166 136 L167 236" fill="none" stroke="#b3a4ad" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
            <path d="M70 132 L69 204 M170 132 L171 204" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
          </g>

          {/* Face */}
          <path d="M78 128 C78 112 96 114 120 114 C144 114 162 112 162 128 C164 158 158 184 142 198 C130 207 110 207 98 198 C82 184 76 158 78 128 Z" fill="url(#wz-skin)" stroke="#241018" strokeWidth="1.6" />
          <ellipse cx="95" cy="176" rx="9" ry="5" fill="#e0887c" opacity="0.3" />
          <ellipse cx="145" cy="176" rx="9" ry="5" fill="#e0887c" opacity="0.3" />

          {/* Eyes, wrinkles and eyelids (blinking) */}
          <path d="M90 150 Q101 142 112 150 Q101 155 90 150 Z" fill="#fbf3ec" stroke="#241018" strokeWidth="1.2" />
          <path d="M128 150 Q139 142 150 150 Q139 155 128 150 Z" fill="#fbf3ec" stroke="#241018" strokeWidth="1.2" />
          <circle cx="101" cy="149.5" r="3.8" fill="#4fa8c9" />
          <circle cx="139" cy="149.5" r="3.8" fill="#4fa8c9" />
          <circle cx="101" cy="149.5" r="1.7" fill="#12161c" />
          <circle cx="139" cy="149.5" r="1.7" fill="#12161c" />
          <circle cx="102.3" cy="148.2" r="1" fill="#fff" />
          <circle cx="140.3" cy="148.2" r="1" fill="#fff" />
          <path d="M89 147 Q101 138 113 147 M127 147 Q139 138 151 147" fill="none" stroke="#241018" strokeWidth="1" />
          <path d="M92 155 Q101 159 110 155 M130 155 Q139 159 148 155 M94 158 Q101 161 108 158 M132 158 Q139 161 146 158" fill="none" stroke="#9c6a55" strokeWidth="0.8" />
          <path d="M88 150 l-7 -3 M88 152 l-7 1 M89 154 l-6 4 M152 150 l7 -3 M152 152 l7 1 M151 154 l6 4" fill="none" stroke="#9c6a55" strokeWidth="0.8" />
          <g className="wz-lids">
            <ellipse cx="101" cy="149" rx="12" ry="6.5" fill="#dba98a" />
            <ellipse cx="139" cy="149" rx="12" ry="6.5" fill="#dba98a" />
          </g>

          {/* Eyebrows */}
          <path d="M80 143 C82 131 98 125 116 133 C113 139 105 137 97 139 C90 141 85 146 80 143 Z" fill="#f4eff1" stroke="#7d6e77" strokeWidth="1" />
          <path d="M160 143 C158 131 142 125 124 133 C127 139 135 137 143 139 C150 141 155 146 160 143 Z" fill="#f4eff1" stroke="#7d6e77" strokeWidth="1" />

          {/* Nose */}
          <path d="M120 146 C116 160 110 170 112 176 C115 182 125 182 128 176 C130 170 124 160 120 146 Z" fill="#d49a79" stroke="#241018" strokeWidth="1.2" />
          <path d="M113 176 q3 2 5 0 M122 176 q3 2 5 0" fill="none" stroke="#6b3a2c" strokeWidth="1" />
          <path d="M119 152 q-2 10 -3 18" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.5" />
          <path d="M106 174 q-6 8 -5 16 M134 174 q6 8 5 16" fill="none" stroke="#9c6a55" strokeWidth="0.9" />

          <path className="wz-mouth" d="M110 196 Q120 201 130 196 Q120 199 110 196 Z" fill="#5a2330" />

          {/* Straight beard over the lower face, with beaded braids */}
          <g mask="url(#wz-fade)">
            <path d="M82 164 C72 186 69 214 71 244 C73 270 84 290 101 298 L139 298 C156 290 167 270 169 244 C171 214 168 186 158 164 C153 176 146 184 138 188 C132 194 127 198 120 198 C113 198 108 194 102 188 C94 184 87 176 82 164 Z" fill="#d6cad1" stroke="#7d6e77" strokeWidth="1.2" />
            <path d="M86 171 C78 190 76 218 78 244 C80 266 90 284 105 292 L135 292 C150 284 160 266 162 244 C164 218 162 190 154 171 C149 180 143 186 136 190 C131 194 126 196 120 196 C114 196 109 194 104 190 C97 186 91 180 86 171 Z" fill="url(#wz-hair)" />
            <path d="M85 188 L84 238 M155 188 L156 238 M90 200 L88 270 M102 204 L100 284 M114 208 L113 290 M126 208 L127 290 M138 204 L140 284 M150 198 L152 270" fill="none" stroke="#b3a4ad" strokeWidth="1.2" strokeLinecap="round" opacity="0.85" />
            <path d="M96 212 L95 262 M144 212 L145 262 M120 212 L120 272 M89 196 L88 228 M151 196 L152 228" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
            {[108, 132].map((x) => (
              <g key={x}>
                <ellipse cx={x} cy="249" rx="4.5" ry="14" fill="#f4eff1" stroke="#a99aa3" strokeWidth="0.8" />
                <path d={`M${x} 236 l-3 4 l6 4 l-6 4 l6 4 l-6 4 l3 4`} fill="none" stroke="#8f8088" strokeWidth="1.3" />
                <rect x={x - 4} y="230" width="8" height="6" rx="2" fill="#a8301f" stroke="#241018" strokeWidth="0.8" />
                <rect x={x - 4} y="262" width="8" height="6" rx="2" fill="#a8301f" stroke="#241018" strokeWidth="0.8" />
                <rect x={x - 2.5} y="231" width="3" height="1.6" rx="0.8" fill="#fff" opacity="0.6" />
                <path d={`M${x - 3} 268 q2 10 3 15 q2 -6 4 -15 Z`} fill="#f4eff1" stroke="#a99aa3" strokeWidth="0.8" />
              </g>
            ))}
          </g>

          {/* Mustache */}
          <path d="M120 180 C106 174 88 176 78 189 C72 197 64 203 55 201 C61 213 81 216 96 206 C106 200 114 198 120 196 C126 198 134 200 144 206 C159 216 179 213 185 201 C176 203 168 197 162 189 C152 176 134 174 120 180 Z" fill="#d6cad1" stroke="#7d6e77" strokeWidth="1.1" />
          <path d="M120 182 C107 177 91 179 82 190 C77 196 71 201 64 201 C71 209 85 210 97 202 C107 197 114 195 120 194 C126 195 133 197 143 202 C155 210 169 209 176 201 C169 201 163 196 158 190 C149 179 133 177 120 182 Z" fill="#f7f3f5" />
          <path d="M92 188 q-8 4 -12 10 M148 188 q8 4 12 10" fill="none" stroke="#b3a4ad" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M104 184 q-8 2 -14 8 M136 184 q8 2 14 8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />

          {/* Hat: brim shadow on the face, crown with a bent tip, band with a gem, and brim */}
          <rect x="76" y="112" width="90" height="34" fill="url(#wz-shade)" clipPath="url(#wz-face)" />
          <path d="M82 104 C88 72 100 46 114 28 C122 16 134 10 148 13 C160 16 165 26 158 31 C150 35 142 28 137 34 C130 44 142 70 154 104 Z" fill="url(#wz-hat)" stroke="#241018" strokeWidth="1.6" />
          <path d="M98 78 Q114 70 130 78 M106 58 Q118 52 128 60 M92 94 Q118 86 146 94 M138 36 q4 -6 12 -6" fill="none" stroke="#241018" strokeWidth="0.9" opacity="0.7" />
          <path d="M100 72 Q108 50 118 34" fill="none" stroke="#ff9a7a" strokeWidth="2" opacity="0.35" />
          <path d="M82 98 Q118 108 154 98 L156 110 Q118 120 80 110 Z" fill="#2a211a" stroke="#241018" strokeWidth="1.2" />
          <circle className="wz-gem" cx="118" cy="109" r="4.5" fill="#d4a247" stroke="#241018" strokeWidth="1" />
          <circle cx="116.6" cy="107.6" r="1.3" fill="#fff" />
          <path d="M24 118 C38 102 78 98 120 100 C164 98 206 104 216 118 C208 128 172 128 152 124 C136 122 104 122 88 124 C66 128 32 130 24 118 Z" fill="url(#wz-brim)" stroke="#241018" strokeWidth="1.6" />
          <path d="M40 120 C80 114 160 114 200 120" fill="none" stroke="#4a140c" strokeWidth="1" />
          <path d="M58 110 Q88 104 108 106 M150 106 Q176 106 196 112" fill="none" stroke="#ff9a7a" strokeWidth="1.6" opacity="0.3" />

          {/* Sparks rising from the mist */}
          <circle className="wz-spark" cx="70" cy="250" r="1.8" fill="#ffd98a" />
          <circle className="wz-spark wz-spark-2" cx="170" cy="258" r="1.5" fill="#ffd98a" />
          <circle className="wz-spark wz-spark-3" cx="120" cy="290" r="1.6" fill="#d4a247" />
        </g>
      </svg>
    </div>
  )
}
