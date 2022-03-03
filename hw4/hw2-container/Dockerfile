FROM mongo

COPY . /hw2-container/

ADD import.sh /import.sh
RUN chmod +x /import.sh

CMD ["/import.sh"]