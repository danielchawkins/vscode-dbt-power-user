-- Built in neither target (inferred case).
select id, status
from {{ source('raw', 'orders') }}
