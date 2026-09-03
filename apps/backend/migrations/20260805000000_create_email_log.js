exports.shorthands = undefined;

// Audit trail for every outbound email attempt.
//
// Sends are fire-and-forget from cron jobs and request handlers, and a provider
// failure can't be surfaced to anyone at the time it happens. Without a record
// there is no way to answer "did that email actually go out?" after the fact —
// a disabled Brevo key once went unnoticed for days because every failure path
// only wrote to stdout. `status` distinguishes a real send from the simulated
// one used when no provider is configured, so the two are never confused.
exports.up = pgm => {
  pgm.createTable('email_log', {
    id: 'id',
    kind: { type: 'varchar(64)', notNull: true }, // e.g. 'phantom_warning'
    recipients: { type: 'text[]', notNull: true },
    subject: { type: 'text', notNull: true },
    status: { type: 'varchar(16)', notNull: true }, // sent | failed | simulated | skipped
    provider: { type: 'varchar(16)' }, // brevo | smtp | none
    message_id: { type: 'text' },
    error: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('email_log', ['kind', 'created_at']);
  pgm.createIndex('email_log', 'status', {
    where: "status = 'failed'",
    name: 'email_log_failed_idx',
  });
};

exports.down = pgm => {
  pgm.dropTable('email_log');
};
