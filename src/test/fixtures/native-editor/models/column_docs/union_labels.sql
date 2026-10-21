-- UNION case with two candidates: label is status in one branch and note in the other, both varchar and both described.
select customer_id, status as label
from {{ source('raw', 'orders') }}
union all
select customer_id, note as label
from {{ source('raw', 'orders') }}
