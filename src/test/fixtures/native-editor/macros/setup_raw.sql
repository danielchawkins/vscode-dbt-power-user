{% macro setup_raw() %}
  {% do run_query("create or replace table main.orders (id integer, customer_id integer, amount decimal(10,2), status varchar, note varchar)") %}
  {% do run_query("create or replace table main.customers (id integer, name varchar, active boolean)") %}
  {% do run_query("create or replace table main.contacts (user_id integer, contact varchar)") %}
{% endmacro %}
