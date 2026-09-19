import { pool } from '../database';
import { Lead } from '../models/lead';

export class LeadRepository {
  async create(lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>): Promise<Lead> {
    // Defensive fallback: never insert NULL for the NOT NULL status column.
    // The canonical default comes from migration 001 (DEFAULT 'NEW').
    const status =
      typeof lead.status === 'string' && lead.status.trim() !== '' ? lead.status : 'NEW';
    const result = await pool.query(
      `INSERT INTO leads (source, name, phone, email, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [lead.source, lead.name, lead.phone, lead.email ?? null, status]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<Lead | null> {
    const result = await pool.query('SELECT * FROM leads WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  /**
   * Phase 13 — batch lookup for the conversation list's lead summaries.
   * Single query (no N+1); the controller projects only safe display fields.
   */
  async findByIds(ids: string[]): Promise<Lead[]> {
    const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
    if (unique.length === 0) return [];
    const result = await pool.query('SELECT * FROM leads WHERE id = ANY($1)', [unique]);
    return result.rows;
  }

  /** Escape LIKE wildcards so search terms match literally. */
  private escapeLike(term: string): string {
    return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  private searchWhere(search: string | undefined, values: any[]): string {
    if (!search) return '';
    values.push(`%${this.escapeLike(search)}%`);
    const idx = values.length;
    return `WHERE name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx} OR source ILIKE $${idx} OR status ILIKE $${idx}`;
  }

  async findAll(opts: { search?: string; limit: number; offset: number }): Promise<Lead[]> {
    const values: any[] = [];
    const where = this.searchWhere(opts.search, values);
    values.push(opts.limit, opts.offset);
    const result = await pool.query(
      `SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return result.rows;
  }

  async countAll(opts: { search?: string }): Promise<number> {
    const values: any[] = [];
    const where = this.searchWhere(opts.search, values);
    const result = await pool.query(`SELECT COUNT(*) AS total FROM leads ${where}`, values);
    return Number(result.rows[0]?.total ?? 0);
  }

  async update(id: string, fields: Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>>): Promise<Lead | null> {
    const allowed = ['source', 'name', 'phone', 'email', 'status'];
    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const key of allowed) {
      if (key in fields) {
        setClauses.push(`${key} = $${idx}`);
        // @ts-ignore
        values.push((fields as any)[key]);
        idx++;
      }
    }
    if (setClauses.length === 0) {
      return this.findById(id);
    }
    values.push(id);
    const query = `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }
}

export const leadRepository = new LeadRepository();

export const updateLead = async (id: string, fields: Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>>): Promise<Lead | null> => {
  return leadRepository.update(id, fields);
};

