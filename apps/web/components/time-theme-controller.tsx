"use client";

import { useEffect } from "react";

type DayPhase = "predawn" | "dawn" | "day" | "dusk" | "night";

const THEME_COLORS: Record<DayPhase, string> = {
	predawn: "#171b3f",
	dawn: "#34345f",
	day: "#fff2bd",
	dusk: "#e9ddff",
	night: "#17182f",
};

function getDayPhase(hour: number): DayPhase {
	if (hour < 5) return "predawn";
	if (hour < 9) return "dawn";
	if (hour < 18) return "day";
	if (hour < 21) return "dusk";
	return "night";
}

export function TimeThemeController() {
	useEffect(() => {
		const updateTheme = () => {
			const phase = getDayPhase(new Date().getHours());
			document.documentElement.dataset.dayPhase = phase;
			const themeColor = document.querySelector<HTMLMetaElement>(
				'meta[name="theme-color"]',
			);
			if (themeColor) themeColor.content = THEME_COLORS[phase];
		};

		updateTheme();
		const intervalId = window.setInterval(updateTheme, 5 * 60 * 1000);
		return () => window.clearInterval(intervalId);
	}, []);

	return null;
}
