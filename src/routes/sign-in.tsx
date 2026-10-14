import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { pageHead } from '@/lib/lambda';
import { Button } from '@/components/ui/button';
export const Route = createFileRoute('/sign-in')({ head: () => pageHead('Student access', 'Student account access for Lambda Prep.'), component: SignIn });
function SignIn() { return <main className="container access-page"><ShieldCheck size={42} strokeWidth={1.4} /><h1>Learning starts here.</h1><p>Student accounts aren’t available yet. You can explore every class and subject without signing in.</p><Button asChild size="lg"><Link to="/resources">Explore resources <ArrowUpRight /></Link></Button><Link to="/" className="back-link"><ArrowLeft size={15} /> Back to Lambda Prep</Link></main>; }
