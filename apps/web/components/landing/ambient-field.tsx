export type AmbientFieldProps = {
	paused?: boolean;
};

export function AmbientField({ paused = false }: AmbientFieldProps) {
	return (
		<div
			aria-hidden="true"
			className={`tmx-ambient${paused ? " is-paused" : ""}`}
		>
			<div className="tmx-ambient__wash tmx-ambient__wash--one" />
			<div className="tmx-ambient__wash tmx-ambient__wash--two" />
			<div className="tmx-ambient__halo">
				<div className="tmx-ambient__orbit-wrap">
					<svg viewBox="0 0 520 520">
						<circle cx="260" cy="260" r="184" />
						<circle className="tmx-ambient__orbit-inner" cx="260" cy="260" r="126" />
					</svg>
				</div>
				<span className="tmx-ambient__light" />
			</div>
			<div className="tmx-ambient__particles">
				{Array.from({ length: 7 }, (_, index) => (
					<span key={index} />
				))}
			</div>
		</div>
	);
}
