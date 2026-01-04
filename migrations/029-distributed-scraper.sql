-- Distributed Scraper System
-- Enables multiple devices to scrape different states simultaneously

-- Track active scraper devices
CREATE TABLE IF NOT EXISTS scraper_devices (
    device_id VARCHAR(64) PRIMARY KEY,
    device_name VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    assigned_state VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active', -- active, idle, crashed, disconnected
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    registered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_records_extracted INTEGER DEFAULT 0,
    total_images_processed INTEGER DEFAULT 0,
    current_location TEXT,
    current_image_index INTEGER,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Track state assignments and progress
CREATE TABLE IF NOT EXISTS scraper_state_assignments (
    id SERIAL PRIMARY KEY,
    state_name VARCHAR(50) NOT NULL,
    year INTEGER DEFAULT 1860,
    collection_id VARCHAR(20) DEFAULT '3161105',
    assigned_device_id VARCHAR(64) REFERENCES scraper_devices(device_id),
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, paused
    priority INTEGER DEFAULT 5,
    total_locations INTEGER,
    completed_locations INTEGER DEFAULT 0,
    total_images INTEGER,
    completed_images INTEGER DEFAULT 0,
    total_records INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_activity TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(state_name, year, collection_id)
);

-- Log of scraper events for debugging
CREATE TABLE IF NOT EXISTS scraper_events (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(64) REFERENCES scraper_devices(device_id),
    event_type VARCHAR(50) NOT NULL, -- heartbeat, extraction, error, state_complete, device_crash
    state_name VARCHAR(50),
    location TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_scraper_devices_status ON scraper_devices(status);
CREATE INDEX IF NOT EXISTS idx_scraper_devices_heartbeat ON scraper_devices(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_scraper_state_assignments_status ON scraper_state_assignments(status);
CREATE INDEX IF NOT EXISTS idx_scraper_events_device ON scraper_events(device_id);
CREATE INDEX IF NOT EXISTS idx_scraper_events_type ON scraper_events(event_type);
CREATE INDEX IF NOT EXISTS idx_scraper_events_created ON scraper_events(created_at);

-- Insert initial state assignments for 1860 slave schedule
-- Skip Alabama (running on main device) and Arkansas (already done)
INSERT INTO scraper_state_assignments (state_name, year, priority, status) VALUES
    ('Alabama', 1860, 1, 'in_progress'),      -- Currently running on main device
    ('Arkansas', 1860, 2, 'completed'),        -- Already done
    ('Delaware', 1860, 3, 'pending'),
    ('Florida', 1860, 4, 'pending'),
    ('Georgia', 1860, 5, 'pending'),
    ('Kentucky', 1860, 6, 'pending'),
    ('Louisiana', 1860, 7, 'pending'),
    ('Maryland', 1860, 8, 'pending'),
    ('Mississippi', 1860, 9, 'pending'),
    ('Missouri', 1860, 10, 'pending'),
    ('North Carolina', 1860, 11, 'pending'),
    ('South Carolina', 1860, 12, 'pending'),
    ('Tennessee', 1860, 13, 'pending'),
    ('Texas', 1860, 14, 'pending'),
    ('Virginia', 1860, 15, 'pending')
ON CONFLICT (state_name, year, collection_id) DO NOTHING;

-- View for monitoring dashboard
CREATE OR REPLACE VIEW scraper_dashboard AS
SELECT
    d.device_id,
    d.device_name,
    d.status as device_status,
    d.assigned_state,
    d.last_heartbeat,
    EXTRACT(EPOCH FROM (NOW() - d.last_heartbeat)) as seconds_since_heartbeat,
    CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - d.last_heartbeat)) > 300 THEN 'CRASHED'
        WHEN EXTRACT(EPOCH FROM (NOW() - d.last_heartbeat)) > 60 THEN 'WARNING'
        ELSE 'OK'
    END as health_status,
    d.total_records_extracted,
    d.current_location,
    s.total_locations,
    s.completed_locations,
    ROUND((s.completed_locations::numeric / NULLIF(s.total_locations, 0)) * 100, 2) as progress_percent
FROM scraper_devices d
LEFT JOIN scraper_state_assignments s ON d.assigned_state = s.state_name AND s.year = 1860;

-- View for state progress
CREATE OR REPLACE VIEW scraper_state_progress AS
SELECT
    state_name,
    year,
    status,
    assigned_device_id,
    total_locations,
    completed_locations,
    total_records,
    ROUND((completed_locations::numeric / NULLIF(total_locations, 0)) * 100, 2) as progress_percent,
    started_at,
    completed_at,
    last_activity,
    CASE
        WHEN status = 'completed' THEN 'Done'
        WHEN assigned_device_id IS NULL THEN 'Unassigned'
        WHEN last_activity < NOW() - INTERVAL '5 minutes' THEN 'Stalled'
        ELSE 'Active'
    END as activity_status
FROM scraper_state_assignments
ORDER BY priority;
