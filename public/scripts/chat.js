const socket = io(window.location.origin);

$(() => {
  socket.emit('chats');

  const form = $('#chat');
  const chatWindow = $('#chat-window');

  form.submit(e => {
    e.preventDefault();

    const chatInput = $($(e.target).children()[0]);
    const chatText = chatInput.val();
    chatInput.val('');

    socket.emit('chat', {
      message: chatText,
      date: new Date().toJSON()
    });
  });

  socket.on('chat', chats => {
    chatWindow.html('');
    chats.forEach(({ user, message, date }) => {
      const userElem = $(`<b></b>`).text(`${user}: `);
      const messageElem = $(`<span id="chat-message"></span>`).text(message);
      const dateElem = $(`<span id="chat-date">&nbsp;-&nbsp;${new Date(date).toLocaleString()}</span>`);

      const chatElem = $('<p class="chat"></p>').append(userElem, messageElem, dateElem);

      chatWindow.append(chatElem);

      dateElem.css('width', 'auto');
      dateElem.attr('data-width', `${dateElem.innerWidth()}px`);
      dateElem.removeAttr('style');

      dateElem.addClass('toggled');

      chatElem.hover(
        () => {
          dateElem.css('width', dateElem.attr('data-width'));
        },
        () => {
          dateElem.removeAttr('style');
        }
      );
    });
  });
});
