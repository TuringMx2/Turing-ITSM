import Image from "next/image";

export function LogoLoader() {
	return (
		<div aria-busy="true" aria-label="Loading" className="logo-loader" role="status">
			<span className="logo-loader__mark">
				<Image
					alt=""
					aria-hidden="true"
					className="logo-loader__image"
					height={1024}
					sizes="(max-width: 480px) 56px, 8vw"
					src="/logo.png"
					unoptimized
					width={1024}
				/>
			</span>
		</div>
	);
}
