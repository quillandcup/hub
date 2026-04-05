-- Change prickles.host from TEXT to foreign key reference to members

-- Step 1: Add new host_id column
ALTER TABLE prickles ADD COLUMN host_id UUID REFERENCES members(id) ON DELETE SET NULL;

-- Step 2: Migrate existing data - match host names to member IDs
UPDATE prickles p
SET host_id = (
    SELECT m.id
    FROM members m
    WHERE m.name = p.host
    LIMIT 1
)
WHERE p.host IS NOT NULL AND p.host != 'Unknown';

-- Step 3: Drop old host column
ALTER TABLE prickles DROP COLUMN host;

-- Step 4: Rename host_id to host
ALTER TABLE prickles RENAME COLUMN host_id TO host;

-- Step 5: Add index on host
CREATE INDEX IF NOT EXISTS idx_prickles_host ON prickles(host);

COMMENT ON COLUMN prickles.host IS 'Foreign key to members table - the member who hosted this prickle';
