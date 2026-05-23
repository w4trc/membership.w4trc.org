#!/usr/bin/env node

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the project root (one level up from mcp/)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL   = process.env.KARC_BASE_URL    || 'https://members.w4trc.org';
const ADMIN_EMAIL = process.env.KARC_ADMIN_EMAIL;
const ADMIN_PASS  = process.env.KARC_ADMIN_PASSWORD;
const CF_TOKEN    = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const CF_ACCOUNT  = process.env.CF_ACCOUNT_ID   || '4b724b576c4285b15dfd8aa32fc83af7';
const CF_DB_ID    = process.env.CF_DATABASE_ID  || '3f035a24-d216-42c8-9587-4a6a0cc22e24';

let sessionCookie = null;

async function login() {
  if (!ADMIN_EMAIL || !ADMIN_PASS) {
    throw new Error('KARC_ADMIN_EMAIL and KARC_ADMIN_PASSWORD env vars are required for API tools');
  }
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }
  const setCookie = res.headers.get('set-cookie');
  const match = setCookie?.match(/karc_session=([^;]+)/);
  if (!match) throw new Error('No session cookie in login response');
  sessionCookie = `karc_session=${match[1]}`;
}

async function apiRequest(method, path, body) {
  if (!sessionCookie) await login();

  const opts = {
    method,
    headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res = await fetch(`${BASE_URL}${path}`, opts);

  if (res.status === 401) {
    sessionCookie = null;
    await login();
    opts.headers.Cookie = sessionCookie;
    res = await fetch(`${BASE_URL}${path}`, opts);
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

async function queryD1(sql, params = []) {
  if (!CF_TOKEN) throw new Error('CF_API_TOKEN env var is required for query_database');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${CF_DB_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result;
}

const TOOLS = [
  {
    name: 'query_database',
    description:
      'Run a SQL query directly against the KARC D1 database via Cloudflare API. ' +
      'Great for ad-hoc analytics, aggregations, or any query not covered by the other tools. ' +
      'Requires CF_API_TOKEN env var. Tables: members, memberships, notes, users, prospects, audit_log.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query to execute (use ? for bound parameters)' },
        params: {
          type: 'array',
          items: {},
          description: 'Values to bind to ? placeholders in order',
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'list_members',
    description: 'Search and list club members with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        search:  { type: 'string',  description: 'Search by callsign, name, or email' },
        status:  { type: 'string',  enum: ['all', 'active', 'inactive', 'silent_key'], description: 'Filter by member status (default: all)' },
        year:    { type: 'string',  description: 'Only return members with a membership record in this year' },
        arrl:    { type: 'string',  enum: ['all', 'arrl', 'nonarrl'] },
        page:    { type: 'number',  description: 'Page number (50 per page, default: 1)' },
      },
    },
  },
  {
    name: 'get_member',
    description: 'Get full details for one member including all membership years and notes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Member ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_member',
    description: 'Create a new member record. Optionally also create their current-year membership.',
    inputSchema: {
      type: 'object',
      properties: {
        first_name:       { type: 'string' },
        last_name:        { type: 'string' },
        callsign:         { type: 'string' },
        email:            { type: 'string' },
        phone:            { type: 'string' },
        address:          { type: 'string' },
        city:             { type: 'string' },
        state:            { type: 'string' },
        zip:              { type: 'string' },
        license_class:    { type: 'string', enum: ['Technician', 'General', 'Extra'] },
        license_expiry:   { type: 'string', description: 'YYYY-MM-DD' },
        membership_type:  { type: 'string', enum: ['individual', 'family', 'lifetime_honorary'] },
        is_arrl_member:   { type: 'boolean' },
        joined_date:      { type: 'string', description: 'YYYY-MM-DD (defaults to today)' },
        create_membership: { type: 'boolean', description: 'Also create a current-year membership record' },
        ms_amount_paid:   { type: 'number',  description: 'Amount paid (if create_membership: true)' },
        ms_paid_date:     { type: 'string',  description: 'YYYY-MM-DD paid date (if create_membership: true)' },
        ms_payment_method: { type: 'string', description: 'cash|check|card|online (if create_membership: true)' },
        ms_check_number:  { type: 'string',  description: 'Check number (if create_membership: true)' },
      },
      required: ['first_name', 'last_name'],
    },
  },
  {
    name: 'update_member',
    description: 'Update fields on an existing member record.',
    inputSchema: {
      type: 'object',
      properties: {
        id:               { type: 'number', description: 'Member ID' },
        callsign:         { type: 'string' },
        first_name:       { type: 'string' },
        last_name:        { type: 'string' },
        email:            { type: 'string' },
        phone:            { type: 'string' },
        address:          { type: 'string' },
        city:             { type: 'string' },
        state:            { type: 'string' },
        zip:              { type: 'string' },
        license_class:    { type: 'string' },
        license_expiry:   { type: 'string' },
        license_status:   { type: 'string' },
        membership_type:  { type: 'string' },
        is_active:        { type: 'boolean' },
        is_silent_key:    { type: 'boolean' },
        is_arrl_member:   { type: 'boolean' },
        bio:              { type: 'string' },
        interests:        { type: 'string' },
        emergency_name:   { type: 'string' },
        emergency_phone:  { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_memberships',
    description: 'List all membership records for a given year.',
    inputSchema: {
      type: 'object',
      properties: {
        year:   { type: 'number', description: 'Year (defaults to current year)' },
        status: { type: 'string', enum: ['all', 'active', 'honorary', 'unpaid'], description: 'Filter by status (default: all)' },
      },
    },
  },
  {
    name: 'get_membership_stats',
    description: 'Get membership statistics for a year: total count, paid count, revenue, by type.',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'Year (defaults to current year)' },
      },
    },
  },
  {
    name: 'create_membership',
    description: 'Create a new membership record for a member in a given year.',
    inputSchema: {
      type: 'object',
      properties: {
        member_id:           { type: 'number' },
        year:                { type: 'number' },
        status:              { type: 'string', enum: ['active', 'honorary', 'unpaid'] },
        membership_type:     { type: 'string', enum: ['individual', 'family'] },
        amount_due:          { type: 'number' },
        amount_paid:         { type: 'number' },
        paid_date:           { type: 'string', description: 'YYYY-MM-DD' },
        payment_method:      { type: 'string', enum: ['cash', 'check', 'card', 'online'] },
        check_number:        { type: 'string' },
        notes:               { type: 'string' },
        covered_by_member_id: { type: 'number', description: 'ID of member covering dues (family plan)' },
      },
      required: ['member_id', 'year'],
    },
  },
  {
    name: 'update_membership',
    description: 'Update a membership record — record a payment, change status, add notes, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        id:                  { type: 'number', description: 'Membership record ID' },
        status:              { type: 'string' },
        membership_type:     { type: 'string' },
        amount_due:          { type: 'number' },
        amount_paid:         { type: 'number' },
        paid_date:           { type: 'string', description: 'YYYY-MM-DD' },
        payment_method:      { type: 'string' },
        check_number:        { type: 'string' },
        notes:               { type: 'string' },
        covered_by_member_id: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_prospects',
    description: 'List prospective members from the HamDB area scan.',
    inputSchema: {
      type: 'object',
      properties: {
        search:      { type: 'string', description: 'Search by callsign or name' },
        status:      { type: 'string', enum: ['all', 'new', 'contacted', 'converted', 'not_interested'] },
        city:        { type: 'string', description: 'Filter by city' },
        postcard:    { type: 'string', enum: ['all', 'sent', 'not_sent'] },
        license_age: { type: 'string', enum: ['all', 'new', 'recent', 'established'] },
        page:        { type: 'number' },
      },
    },
  },
  {
    name: 'update_prospect',
    description: 'Update outreach status, postcard status, or notes on a prospect.',
    inputSchema: {
      type: 'object',
      properties: {
        id:              { type: 'number', description: 'Prospect ID' },
        status:          { type: 'string', enum: ['new', 'contacted', 'converted', 'not_interested'] },
        postcard_sent:   { type: 'boolean' },
        outreach_notes:  { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_note',
    description: 'Add a note to a member record.',
    inputSchema: {
      type: 'object',
      properties: {
        member_id:  { type: 'number' },
        note_text:  { type: 'string' },
        is_private: { type: 'boolean', description: 'Private notes are board/admin only (default: true)' },
      },
      required: ['member_id', 'note_text'],
    },
  },
  {
    name: 'get_prospect_stats',
    description: 'Get summary counts for prospects (total, by status, by city, etc.).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

const server = new Server(
  { name: 'karc-membership', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    let result;

    switch (name) {
      case 'query_database': {
        result = await queryD1(args.sql, args.params ?? []);
        break;
      }
      case 'list_members': {
        const p = new URLSearchParams();
        if (args.search) p.set('q', args.search);
        if (args.status) p.set('status', args.status);
        if (args.year)   p.set('year', String(args.year));
        if (args.arrl)   p.set('arrl', args.arrl);
        if (args.page)   p.set('page', String(args.page));
        result = await apiRequest('GET', `/api/members?${p}`);
        break;
      }
      case 'get_member': {
        result = await apiRequest('GET', `/api/members/${args.id}`);
        break;
      }
      case 'create_member': {
        result = await apiRequest('POST', '/api/members', args);
        break;
      }
      case 'update_member': {
        const { id, ...body } = args;
        result = await apiRequest('PUT', `/api/members/${id}`, body);
        break;
      }
      case 'list_memberships': {
        const p = new URLSearchParams();
        if (args.year)   p.set('year', String(args.year));
        if (args.status) p.set('status', args.status);
        result = await apiRequest('GET', `/api/memberships?${p}`);
        break;
      }
      case 'get_membership_stats': {
        const p = new URLSearchParams();
        if (args.year) p.set('year', String(args.year));
        result = await apiRequest('GET', `/api/memberships/stats?${p}`);
        break;
      }
      case 'create_membership': {
        result = await apiRequest('POST', '/api/memberships', args);
        break;
      }
      case 'update_membership': {
        const { id, ...body } = args;
        result = await apiRequest('PUT', `/api/memberships/${id}`, body);
        break;
      }
      case 'list_prospects': {
        const p = new URLSearchParams();
        if (args.search)      p.set('q', args.search);
        if (args.status)      p.set('status', args.status);
        if (args.city)        p.set('city', args.city);
        if (args.postcard)    p.set('postcard', args.postcard);
        if (args.license_age) p.set('license_age', args.license_age);
        if (args.page)        p.set('page', String(args.page));
        result = await apiRequest('GET', `/api/prospects?${p}`);
        break;
      }
      case 'update_prospect': {
        const { id, ...body } = args;
        result = await apiRequest('PUT', `/api/prospects/${id}`, body);
        break;
      }
      case 'add_note': {
        result = await apiRequest('POST', '/api/notes', args);
        break;
      }
      case 'get_prospect_stats': {
        result = await apiRequest('GET', '/api/prospects/stats');
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
