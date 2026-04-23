-- Add missing prickle types found in calendar imports

INSERT INTO prickle_types (name, normalized_name, description) VALUES
    ('Midnight Crew', 'midnight-crew', 'Midnight Crew writing sessions'),
    ('Feel Good Friday Prickle', 'feel-good-friday', 'Feel Good Friday prickles')
ON CONFLICT (normalized_name) DO NOTHING;
