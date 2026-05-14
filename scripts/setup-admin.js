#!/usr/bin/env node
/**
 * KARC Setup Script
 * Run this locally to generate the setup API call for creating your first admin account.
 *
 * Usage:
 *   node scripts/setup-admin.js
 *
 * This will prompt for your setup key and password, then output the curl command
 * to POST to /api/setup and create your admin account.
 */

const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const q  = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

async function main() {
  console.log('\n🔧 KARC Membership System - Initial Admin Setup\n');
  console.log('Before running this, make sure you have:');
  console.log('  1. Created your D1 database: wrangler d1 create karc-membership');
  console.log('  2. Run the schema: npm run db:init');
  console.log('  3. Set your setup key: wrangler secret put ADMIN_SETUP_KEY');
  console.log('  4. Deployed the worker: npm run deploy\n');

  const domain    = await q('Worker URL (e.g. https://members.w4trc.org): ');
  const setupKey  = await q('ADMIN_SETUP_KEY (what you set as the secret): ');
  const email     = await q('Admin email [admin@w4trc.org]: ') || 'admin@w4trc.org';
  const password  = await q('Admin password (10+ chars): ');
  const callsign  = await q('Your callsign [N4JHC]: ') || 'N4JHC';
  const firstName = await q('First name: ');
  const lastName  = await q('Last name: ');

  if (password.length < 10) {
    console.error('\n❌ Password must be at least 10 characters');
    process.exit(1);
  }

  const body = JSON.stringify({ setup_key: setupKey, email, password, callsign, first_name: firstName, last_name: lastName });

  console.log('\n── Run this curl command ──────────────────────────────────────────');
  console.log(`curl -X POST ${domain.trim()}/api/setup \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '${body}'`);
  console.log('───────────────────────────────────────────────────────────────────\n');
  console.log('Or you can run it now (press Enter):');

  const run = await q('Run now? [Y/n]: ');
  if (run.toLowerCase() !== 'n') {
    const { default: fetch } = await import('node-fetch').catch(() => ({ default: null }));
    if (!fetch) {
      console.log('node-fetch not available. Copy the curl command above.');
      rl.close();
      return;
    }
    try {
      const resp = await fetch(domain.trim() + '/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await resp.json();
      if (resp.ok) {
        console.log('\n✅ Admin account created successfully!');
        console.log('   Email:', email);
        console.log('   Login at:', domain.trim() + '/');
        console.log('\n⚠️  Change your password after first login via Admin > User Accounts\n');
      } else {
        console.error('\n❌ Error:', data.error);
      }
    } catch (err) {
      console.error('\n❌ Request failed:', err.message);
      console.log('Try the curl command manually.');
    }
  }

  rl.close();
}

main().catch(console.error);
