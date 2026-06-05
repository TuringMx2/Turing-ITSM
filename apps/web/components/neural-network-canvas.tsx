"use client";

import { useEffect, useRef } from "react";

class Particle {
	x = 0;
	y = 0;
	size = 0;
	color = "";
	vx = 0;
	vy = 0;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		colors: string[],
	) {
		this.x = Math.random() * canvas.width;
		this.y = Math.random() * canvas.height;
		this.size = Math.random() * 2 + 1;
		this.color = colors[Math.floor(Math.random() * colors.length)];
		this.vx = (Math.random() - 0.5) * 0.5;
		this.vy = (Math.random() - 0.5) * 0.5;
	}

	draw(ctx: CanvasRenderingContext2D) {
		ctx.fillStyle = this.color;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
		ctx.closePath();
		ctx.fill();
	}

	update(mouse: { x: number; y: number; radius: number }) {
		this.x += this.vx;
		this.y += this.vy;

		if (this.x < 0 || this.x > this.canvas.width) this.vx *= -1;
		if (this.y < 0 || this.y > this.canvas.height) this.vy *= -1;

		const dx = mouse.x - this.x;
		const dy = mouse.y - this.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance > 0 && distance < mouse.radius) {
			const force = (mouse.radius - distance) / mouse.radius;
			this.x += (dx / distance) * force * 2;
			this.y += (dy / distance) * force * 2;
		}
	}
}

export function NeuralNetworkCanvas() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;

		const drawingCanvas = canvas;
		const drawingContext = ctx;
		let animationFrameId = 0;
		let particles: Particle[] = [];
		const mouse = { x: -1000, y: -1000, radius: 150 };
		const colors = ["#1db9a6", "#3b82f6", "#22c55e"];

		function resize() {
			drawingCanvas.width = window.innerWidth;
			drawingCanvas.height = window.innerHeight;
			particles = Array.from(
				{
					length: Math.max(
						60,
						Math.floor((drawingCanvas.width * drawingCanvas.height) / 9000),
					),
				},
				() => new Particle(drawingCanvas, colors),
			);
		}

		function handleMouseMove(event: MouseEvent) {
			mouse.x = event.clientX;
			mouse.y = event.clientY;
		}

		function connect() {
			particles.forEach((particle, index) => {
				for (
					let nextIndex = index;
					nextIndex < particles.length;
					nextIndex += 1
				) {
					const nextParticle = particles[nextIndex];
					const dx = particle.x - nextParticle.x;
					const dy = particle.y - nextParticle.y;
					const distance = Math.sqrt(dx * dx + dy * dy);

					if (distance < 150) {
						const opacity = 1 - distance / 150;
						drawingContext.strokeStyle = `rgba(59, 130, 246, ${opacity * 0.22})`;
						drawingContext.lineWidth = 0.5;
						drawingContext.beginPath();
						drawingContext.moveTo(particle.x, particle.y);
						drawingContext.lineTo(nextParticle.x, nextParticle.y);
						drawingContext.stroke();
					}
				}
			});
		}

		function animate() {
			drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
			particles.forEach((particle) => {
				particle.update(mouse);
				particle.draw(drawingContext);
			});
			connect();
			animationFrameId = requestAnimationFrame(animate);
		}

		resize();
		animate();
		window.addEventListener("resize", resize);
		window.addEventListener("mousemove", handleMouseMove);

		return () => {
			window.removeEventListener("resize", resize);
			window.removeEventListener("mousemove", handleMouseMove);
			cancelAnimationFrame(animationFrameId);
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			aria-hidden="true"
			className="neural-network-canvas"
		/>
	);
}
