-- Built in dev by the suites. Its schema.yml omits order_count (add case).
select customer_id, count(*) as order_count, max(status) as last_status
from {{ source('raw', 'orders') }}
group by customer_id
