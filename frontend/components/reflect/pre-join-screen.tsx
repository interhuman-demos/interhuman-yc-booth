'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { Phone } from 'lucide-react';
import { SIGNAL_EMOJI } from '@/lib/signals';
import { DitherAnimation } from '@/components/dither-animation';

interface PreJoinScreenProps {
	onStart: () => void;
}

const signalColorMap: Record<string, string> = {
	agreement: 'oklch(0.55 0.15 145)',
	confidence: 'oklch(0.55 0.15 240)',
	confusion: 'oklch(0.60 0.13 75)',
	disagreement: 'oklch(0.52 0.18 25)',
	disengagement: 'oklch(0.52 0.04 250)',
	engagement: 'oklch(0.55 0.18 295)',
	frustration: 'oklch(0.58 0.16 45)',
	hesitation: 'oklch(0.62 0.13 90)',
	interest: 'oklch(0.55 0.15 215)',
	skepticism: 'oklch(0.52 0.04 270)',
	stress: 'oklch(0.52 0.18 10)',
	uncertainty: 'oklch(0.55 0.15 310)',
};

const features = [
	{
		signal: 'engagement' as const,
		title: 'Engaged',
		description:
			'Engaged reflects sustained focus and active participation in the interaction. An engaged person maintains eye contact, sits upright or leans forward, offers timely nods and short backchannels like "mm-hmm" or "I see," and keeps their body oriented toward the speaker. They might ask brief, task-focused questions that show they are following along.',
	},
	{
		signal: 'disengagement' as const,
		title: 'Disengaged',
		description:
			'Disengaged signals a reduction in attention, involvement, or investment in the interaction. A disengaged person appears mentally or emotionally withdrawn, contributes minimally, and shows limited responsiveness to what is happening. This often indicates that the interaction no longer feels relevant or worth sustained effort.',
	},
	{
		signal: 'agreement' as const,
		title: 'Agreement',
		description:
			`Agreement reflects alignment with another person's position, intent, or understanding. It appears when someone signals that they are on the same page and moving in the same direction as the speaker. This can take the form of affirming responses or moments where the listener reinforces or builds on what has just been said, indicating shared understanding.`,
	},
	{
		signal: 'confidence' as const,
		title: 'Confidence',
		description:
			'Confidence captures how firmly and assuredly someone communicates their position or decision. A confident person presents ideas with clarity and conviction, without excessive qualification or visible doubt. Their delivery suggests comfort with the stance they are taking and readiness to stand behind it.',
	},
	{
		signal: 'confusion' as const,
		title: 'Confusion',
		description:
			'Confusion indicates a breakdown or gap in understanding during an interaction. It emerges when someone struggles to follow the content, structure, or implications of what is being discussed. This state often leads to pauses, clarification attempts, or visible effort to reorient and regain clarity.',
	},
	{
		signal: 'disagreement' as const,
		title: 'Disagreement',
		description:
			`Disagreement reflects an active divergence from another person's viewpoint or proposal. It arises when someone challenges, rejects, or pushes back against what is being presented. Rather than passive misalignment, disagreement involves a clear stance that the current direction or claim is not accepted.`,
	},
	{
		signal: 'frustration' as const,
		title: 'Frustration',
		description:
			'Frustration emerges when progress toward a goal feels blocked or repeatedly unsuccessful. It reflects mounting tension or irritation as expectations are unmet. This state is often associated with a sense of effort without payoff and can precede disengagement or escalation if unresolved.',
	},
	{
		signal: 'hesitation' as const,
		title: 'Hesitation',
		description:
			'Hesitation captures uncertainty or delay before committing to a response or action. It reflects moments where someone is weighing options, searching for the right wording, or holding back before moving forward. Hesitation often signals that a decision or stance is not yet fully formed.',
	},
	{
		signal: 'interest' as const,
		title: 'Interest',
		description:
			'Interest reflects positive engagement driven by relevance or curiosity. An interested person appears drawn into the topic and motivated to continue the exchange. This state is marked by attentiveness and signals that the content resonates or holds value for them.',
	},
	{
		signal: 'skepticism' as const,
		title: 'Skepticism',
		description:
			'Skepticism represents a questioning or doubtful stance toward a claim, proposal, or explanation. Rather than outright rejection, it involves cautious evaluation and a desire for justification or evidence. Skepticism often surfaces when information conflicts with prior beliefs or seems insufficiently supported.',
	},
	{
		signal: 'stress' as const,
		title: 'Stress',
		description:
			'Stress indicates heightened pressure or cognitive load during an interaction. It reflects a state where demands feel intense, time-sensitive, or difficult to manage. Under stress, people may prioritize speed or coping over depth, signaling strain rather than deliberate engagement.',
	},
	{
		signal: 'uncertainty' as const,
		title: 'Uncertainty',
		description:
			`Uncertainty reflects low confidence in one's own knowledge, judgment, or decision. It appears when someone is unsure about the correctness or appropriateness of what they are saying or choosing. This state often involves tentative positioning and openness to revision or guidance.`,
	},
];

const staggerContainer = {
	hidden: {},
	visible: {
		transition: {
			staggerChildren: 0.08,
		},
	},
};

const fadeUp = {
	hidden: { opacity: 0, y: 16 },
	visible: {
		opacity: 1,
		y: 0,
		transition: {
			duration: 0.5,
			ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
		},
	},
};

const imageReveal = {
	hidden: { clipPath: 'inset(0 0 100% 0)' },
	visible: {
		clipPath: 'inset(0 0 0% 0)',
		transition: {
			duration: 1,
			ease: [0.77, 0, 0.175, 1] as [number, number, number, number],
		},
	},
};

export function PreJoinScreen({ onStart }: PreJoinScreenProps) {
	const [hovered, setHovered] = useState(false);
	const [hasScrolled, setHasScrolled] = useState(false);
	const [heroOutOfView, setHeroOutOfView] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const heroRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			if (el.scrollTop > 10) setHasScrolled(true);
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	}, []);

	useEffect(() => {
		const hero = heroRef.current;
		if (!hero) return;
		const observer = new IntersectionObserver(
			([entry]) => setHeroOutOfView(!entry.isIntersecting),
			{ threshold: 0.1 }
		);
		observer.observe(hero);
		return () => observer.disconnect();
	}, []);

	return (
		<LayoutGroup>
		<div ref={scrollRef} className="flex w-full flex-col overflow-y-auto">


			{/* Hero Section */}
			<section ref={heroRef} className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-6 px-4">


			<motion.a
					target="_blank"
					href="https://docs.interhuman.ai/getting-started/introduction"
					initial={{ opacity: 0, scale: 0.95 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: 0.4, duration: 1, ease: [0.165, 0.84, 0.44, 1] }}
					className="group fixed top-4 left-4 surface flex items-center gap-1 rounded-lg pl-2 pr-3 py-2 text-sm transition-[background-color,box-shadow] duration-150 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] hover:bg-accent active:scale-[0.96]"
				>
					<img src="/interhuman-ai-monogram-light.svg" alt="Interhuman" className="h-6 w-6 rounded-xs" />
					<span className='opacity-50'>Powerd by</span>
					<span>Interhuman AI</span>
					</motion.a>




				{/* Hero card — inline when hero is in view */}
				{!heroOutOfView && (
					<motion.div
						layoutId="hero-card"
						transition={{ type: 'spring', duration: 0.6, bounce: 0.15 }}
						className="flex w-[300px] h-[450px] justify-between flex-col items-center gap-4 rounded-[32px] bg-[#2a1a0e] px-6 pb-6 pt-8 shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_24px_64px_rgba(0,0,0,0.2)]"
					>
						<h1 className="text-balance text-xl font-semibold leading-snug text-white">
							Pitch to the CEO of YC
						</h1>

						<div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-[#f26625] shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_16px_48px_rgba(242,102,37,0.35)]">
							<span className="text-6xl font-bold leading-none text-white">Y</span>
						</div>

						<motion.button
							onClick={onStart}
							onMouseEnter={() => setHovered(true)}
							onMouseLeave={() => setHovered(false)}
							className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,oklch(0.62_0.22_145),oklch(0.50_0.22_140))] text-base font-semibold text-white shadow-[0px_1px_1px_oklch(1_0_0/10%)_inset] transition-[transform,filter] duration-[var(--duration-fast)] hover:brightness-110 active:scale-[0.96]"
						>
							<motion.div
								animate={hovered ? { rotate: [0, -15, 12, -8, 5, -3, 0] } : { rotate: 0 }}
								transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
							>
								<Phone className="size-4" />
							</motion.div>
							Start Pitch
						</motion.button>
					</motion.div>
				)}

				{/* Subtitle below the card */}
				<motion.p
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.25, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
					className="max-w-[260px] text-center text-pretty text-sm leading-relaxed text-muted-foreground/70"
				>
					You have 90 seconds. What are you building, who&apos;s it for, and why are you the one tobuild it?
				</motion.p>

				<AnimatePresence>
					{!hasScrolled && (
						<motion.div
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, y: [0, 4, 0] }}
							exit={{ opacity: 0, y: -6 }}
							transition={{
								opacity: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
								y: { duration: 2, repeat: Infinity, ease: [0.37, 0, 0.63, 1] },
							}}
							className="pointer-events-none absolute bottom-8 flex flex-col items-center rounded-full bg-background surface p-1 text-[#f26625]/70"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M12 5v14M5 12l7 7 7-7" />
							</svg>
						</motion.div>
					)}
				</AnimatePresence>
			</section>



			<section className="flex flex-col items-center px-4 py-12">

<motion.div
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.5, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
					className="flex flex-col items-center gap-4"
				>
					<p className="text-xs font-medium tracking-wide text-muted-foreground/50 uppercase">
						Built on
					</p>
					<div className="flex items-center gap-2">
						<a
							href="https://docs.interhuman.ai/getting-started/introduction"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-xl bg-card p-6 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_0px_rgba(0,0,0,0.04)] transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.96]"
						>
							<img src="/interhuman-ai-monogram-light.svg" alt="Interhuman AI" className="h-5 w-5 rounded-[4px]" />
							<span className="text-sm font-medium text-foreground">Interhuman AI</span>
						</a>
						<a
							href="https://lemonslice.com/docs/overview/intro"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-xl bg-card p-6 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_0px_rgba(0,0,0,0.04)] transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.96]"

						>
							<img src="/lemonslice-logo.png" alt="Lemonslice" className="h-5 w-5 rounded-[4px] object-cover" />
							<span className="text-sm font-medium text-foreground">Lemonslice</span>
						</a>
					</div>
				</motion.div>
</section>


			

			{/* Social Signals */}
			<section className="flex flex-col items-center px-4 pb-32 pt-12">
				<motion.div
					variants={staggerContainer}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true, margin: '-60px' }}
					className="flex flex-col items-start gap-4"
				>
					<motion.div variants={fadeUp} className="text-start">
						<h3 className="text-balance text-2xl font-medium text-foreground">Social Signals</h3>
			
					</motion.div>

					<motion.div
						variants={staggerContainer}
						initial="hidden"
						whileInView="visible"
						viewport={{ once: true, margin: '-40px' }}
						className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-1 lg:grid-cols-2"
					>
						{features.map((feature) => (
							<motion.div
								key={feature.title}
								variants={fadeUp}
								className="group flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_0px_rgba(0,0,0,0.04)] transition-[transform,box-shadow] duration-[var(--duration-fast)]"
							>
			
								<div className="flex flex-col gap-1">
									<p
										className="inline-flex w-fit items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium leading-tight tracking-wide uppercase"
										style={{
											color: signalColorMap[feature.signal] ?? 'oklch(0.60 0.04 0)',
											backgroundColor: `color-mix(in oklch, ${signalColorMap[feature.signal] ?? 'oklch(0.60 0.04 0)'} 10%, transparent)`,
											border: `1px solid color-mix(in oklch, ${signalColorMap[feature.signal] ?? 'oklch(0.60 0.04 0)'} 30%, transparent)`,
										}}
									>
										{feature.title}
									</p>
									<p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
								</div>
							</motion.div>
						))}
					</motion.div>
				</motion.div>
				</section>

				{/* Build with Interhuman */}
			<section className="flex flex-col items-center bg-[#f26625] px-4 py-24">
				<motion.div
					variants={staggerContainer}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true, margin: '-80px' }}
					className="flex max-w-xl flex-col items-center gap-2 text-center"
				>
					<motion.div variants={imageReveal} className="mb-4 w-full max-w-xs">
						<DitherAnimation color="white" className="h-60 w-full" />
					</motion.div>
					<motion.h2 variants={fadeUp} className="text-balance text-2xl font-medium text-white">
					Your product. Our intelligence
					</motion.h2>
					<motion.p variants={fadeUp} className="text-pretty text-base leading-relaxed text-white">
					This is a starting point, not a ceiling. Deploy your own copy in minutes and build with confidence, clarity, and engagement signals baked in from day one.


					</motion.p>

					<motion.div
						variants={fadeUp}
						className="flex flex-wrap items-center justify-center gap-3 pt-2"
					>
						{/* 
						<a
							href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Finterhuman-ai%2Finterhuman-yc-booth&env=OPENAI_API_KEY,LIVEKIT_URL,LIVEKIT_API_KEY,LIVEKIT_API_SECRET,INTERHUMAN_API_KEY&envDescription=API%20keys%20needed%20to%20run%20the%20app"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-[transform,opacity] duration-[var(--duration-fast)] hover:opacity-90 active:scale-[0.96]"
						>
							<svg className="size-4" viewBox="0 0 76 65" fill="currentColor">
								<path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
							</svg>
							Deploy with Vercel
						</a> */}
						<a
							href="https://docs.interhuman.ai"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-10 items-center gap-2 rounded-lg border border-black px-4 text-sm font-medium text-foreground transition-[transform,background-color] duration-[var(--duration-fast)] hover:border-[#f26625] hover:bg-accent active:scale-[0.96]"
						>
							Read the Interhuman docs
						</a>
					</motion.div>
				</motion.div>
			</section>

			{/* Hero card — fixed PiP when scrolled past hero (desktop only) */}
			{heroOutOfView && (
				<motion.div
					layoutId="hero-card"
					transition={{ type: 'spring', duration: 0.6, bounce: 0.15 }}
					className="fixed right-5 bottom-5 z-50 hidden w-[200px] flex-col items-center gap-3 rounded-[20px] bg-[#2a1a0e] px-4 pb-4 pt-5 shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_16px_48px_rgba(0,0,0,0.25)] lg:flex"
				>
					<div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#f26625] shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_8px_24px_rgba(242,102,37,0.3)]">
						<span className="text-2xl font-bold leading-none text-white">Y</span>
					</div>
					<p className="text-center text-xs font-medium text-white/80">
						Pitch to the CEO of YC
					</p>
					<button
						onClick={onStart}
						className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[linear-gradient(180deg,oklch(0.62_0.22_145),oklch(0.50_0.22_140))] text-xs font-semibold text-white shadow-[0px_1px_1px_oklch(1_0_0/10%)_inset] transition-[transform,filter] duration-[var(--duration-fast)] hover:brightness-110 active:scale-[0.96]"
					>
						<Phone className="size-3" />
						Start Pitch
					</button>
				</motion.div>
			)}
		</div>
		</LayoutGroup>
	);
}
