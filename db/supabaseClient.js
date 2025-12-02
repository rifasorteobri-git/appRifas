const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    
);

module.exports = supabase;