select distinct customer_id
from {{ ref("int_orders__enriched") }}
