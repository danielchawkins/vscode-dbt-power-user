select customer_id, sum(amount) as total, count(*) as n, max(status) as last_status
from {{ ref('stg_orders') }}
group by customer_id
