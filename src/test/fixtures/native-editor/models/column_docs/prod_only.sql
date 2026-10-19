-- Built only in prod by setup (deferred case). Dev never builds it.
select customer_id, sum(amount) as total_amount
from {{ source('raw', 'orders') }}
group by customer_id
